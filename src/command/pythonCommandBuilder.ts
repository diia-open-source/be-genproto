/* eslint-disable security/detect-non-literal-fs-filename */
import { once } from 'node:events'
import { WriteStream, createWriteStream, existsSync } from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { finished } from 'node:stream/promises'

import { glob } from 'glob'

import Logger from '../logger'
import { CommandBuilder } from './index'

// import "designSystem/molecules/attentionIconMessageMlc.proto";
const importRegex = /import "(?<path>[^"]+)";/
const slashPrefix = /^\/+/

export default class PythonCommandBuilder extends CommandBuilder {
    private cardinalDependencies: Record<string, string> = {
        'node_modules/@diia-inhouse/types/dist/proto': 'types_proto',
        'node_modules/@diia-inhouse/design-system/dist/proto': 'design_system_proto',
    }

    async protocCommand(): Promise<string[]> {
        const command = [
            'python3',
            '-m grpc_tools.protoc',
            `--python_out=${this.outputDir}`,
            `--grpc_python_out=${this.outputDir}`,
            `--pyi_out=${this.outputDir}`,
            '--proto_path=proto',
            '--proto_path=node_modules/protobufjs/google',
            ...Object.keys(this.cardinalDependencies)
                .filter((path) => existsSync(path)) // nosemgrep: eslint.detect-non-literal-fs-filename
                .map((path) => `--proto_path=${path}`),
        ]

        for (const protoPath in this.protoPaths) {
            command.push(`--proto_path ${protoPath}`)
        }

        this.logger.log('python client build')

        command.push(await this.iPath())

        return command
    }

    async postProcess(): Promise<void> {
        await this.mapPythonImports()

        await touchFilesInTree(this.outputDir, '__init__.py', this.logger)
    }

    // 1. iterate over all present cardinal dependencies
    // 2. store their fullpath as kv pair path-packagename
    // 3. fetch all internal import statements and map them out to package name (from p.2)
    // 4. read all files in outDir. default import pattern is as following
    // 4.1 from designSystem.molecules import attentionIconMessageMlc_pb2
    // 4.2 it translates to designSystem/molecules/attentionIconMessageMlc.proto
    // 4.3 import attentionIconMessageMlc_pb2
    // 4.4 it translates to attentionIconMessageMlc.proto
    private async mapPythonImports(): Promise<void> {
        const protoPattern = '/**/*.proto'
        const mapping: Record<string, string> = {}
        let replaceRules: { from: string; to: string }[] = []

        for (const dep in this.cardinalDependencies) {
            const files = await glob(dep + protoPattern)

            for (const file of files) {
                const res = file.replace(dep, '').replace(slashPrefix, '')

                mapping[res] = this.cardinalDependencies[dep]

                this.logger.log(`I'm putting ${res} as ${dep} for later mapping`)
            }
        }

        const localProtos = await glob('proto' + protoPattern)

        const rulesTasks = []
        for (const localProto of localProtos) {
            rulesTasks.push(replaceRulesTask(localProto, mapping, this.logger))
        }

        const rules = await Promise.all(rulesTasks)

        replaceRules = [...new Map(rules.flat().map((rule) => [rule.from, rule])).values()]

        const generatedFiles = await glob(this.outputDir + '/**/*.py')

        const tasks: Promise<void>[] = []
        for (const generatedFile of generatedFiles) {
            tasks.push(fileMapper(generatedFile, replaceRules, this.logger))
        }

        await Promise.all(tasks)
    }
}

async function touchFilesInTree(dirPath: string, fileName: string, logger: Logger): Promise<void> {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true }) // nosemgrep: eslint.detect-non-literal-fs-filename

    const targetFile = path.join(dirPath, fileName) // nosemgrep: eslint.detect-non-literal-fs-filename
    try {
        const handle = await fsPromises.open(targetFile, 'a') // nosemgrep: eslint.detect-non-literal-fs-filename

        await handle.utimes(new Date(), new Date()) // nosemgrep: eslint.detect-non-literal-fs-filename
        await handle.close()
    } catch (err) {
        logger.log(`Could not touch file in ${dirPath}: ${err instanceof Error ? err.message : err}`)
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const fullPath = path.join(dirPath, entry.name) // nosemgrep: eslint.detect-non-literal-fs-filename

            await touchFilesInTree(fullPath, fileName, logger)
        }
    }
}

async function replaceRulesTask(
    localProto: string,
    mapping: Record<string, string>,
    logger: Logger,
): Promise<{ from: string; to: string }[]> {
    const replaceRules = []

    let handle: fsPromises.FileHandle | undefined
    try {
        handle = await fsPromises.open(localProto) // nosemgrep: eslint.detect-non-literal-fs-filename

        for await (const line of handle.readLines()) {
            const result = importRegex.exec(line)
            const importPath = result?.groups?.path

            if (importPath === undefined) {
                continue
            }

            const dirpath = path.dirname(importPath)
            const fileName = path.basename(importPath, '.proto')

            if (dirpath === '.') {
                const depname = mapping[importPath]

                if (depname === undefined) {
                    logger.log(`Looking for ${importPath} in mapper, received ${depname}. Skipping the mapper.`)
                    continue
                }

                replaceRules.push({
                    from: `import ${fileName}_pb2`,
                    to: `from ${depname} import ${fileName}_pb2`,
                })
            } else {
                const depname = mapping[importPath]

                if (depname === undefined) {
                    logger.log(`Looking for ${importPath} in mapper, received ${depname}. Skipping the mapper.`)
                    continue
                }

                const importName = dirpath.replaceAll('/', '.')

                replaceRules.push({
                    from: `from ${importName} import`,
                    to: `from ${depname}.${importName} import`,
                })
            }
        }
    } finally {
        if (handle) {
            await handle.close()
        }
    }

    return replaceRules
}

async function fileMapper(generatedFile: string, replaceRules: { from: string; to: string }[], logger: Logger): Promise<void> {
    let handle: fsPromises.FileHandle | undefined
    let wstream: WriteStream | undefined
    let isOk = false
    try {
        handle = await fsPromises.open(generatedFile) // nosemgrep: eslint.detect-non-literal-fs-filename

        wstream = createWriteStream(generatedFile + '.new') // nosemgrep: eslint.detect-non-literal-fs-filename

        for await (const line of handle.readLines()) {
            let mutableLine = line
            for (const rule of replaceRules) {
                mutableLine = mutableLine.replace(rule.from, rule.to)
            }

            const writeOk = wstream.write(mutableLine + '\n')

            if (!writeOk) {
                await once(wstream, 'drain')
            }
        }

        isOk = true
    } finally {
        if (handle) {
            await handle.close()
        }

        if (wstream) {
            wstream.end()
            await finished(wstream)

            // nosemgrep: eslint.detect-non-literal-fs-filename
            if (!isOk && existsSync(generatedFile + '.new')) {
                await fsPromises.unlink(generatedFile + '.new') // nosemgrep: eslint.detect-non-literal-fs-filename
            }
        }
    }

    try {
        await fsPromises.rename(generatedFile + '.new', generatedFile) // nosemgrep: eslint.detect-non-literal-fs-filename
        logger.log('Update successful!')
    } catch (err) {
        // nosemgrep: eslint.detect-non-literal-fs-filename
        if (existsSync(generatedFile + '.new')) {
            await fsPromises.unlink(generatedFile + '.new') // nosemgrep: eslint.detect-non-literal-fs-filename
        }

        logger.log(`Final swap failed: ${err}`)
        throw err
    }
}
