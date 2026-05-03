import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import { glob } from 'glob'

import Logger from '../logger'
import { CommandBuilder, Platform } from './index'

const reservedWords = new Set([
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'new',
    'null',
    'return',
    'super',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
    'let',
    'static',
    'implements',
    'interface',
    'package',
    'private',
    'protected',
    'public',
])

export default class TsCommandBuilder extends CommandBuilder {
    // By default ts plugin should be linked to .bin dir but in case if it doesn't
    // try to look it up in "standard" locations
    private tsPluginLocations = [
        './node_modules/.bin/protoc-gen-ts_proto',
        './node_modules/ts-proto/protoc-gen-ts_proto',
        './node_modules/@diia-inhouse/genproto/node_modules/ts-proto/protoc-gen-ts_proto',
    ]

    constructor(
        protected readonly logger: Logger,
        protected readonly generateClient: boolean,
        protected readonly rootDir: string,
        protected readonly outputDir: string,
        protected readonly protoPaths: string[],
        private javaModule?: string,
    ) {
        super(logger, generateClient, rootDir, outputDir, protoPaths)
    }

    async getProtoTsPluginLocation(): Promise<string | undefined> {
        const pluginLocations = []

        for (const location of this.tsPluginLocations) {
            try {
                // eslint-disable-next-line security/detect-non-literal-fs-filename
                await fs.realpath(location) // nosemgrep: eslint.detect-non-literal-fs-filename
            } catch {
                continue
            }

            pluginLocations.push(location)
        }

        return pluginLocations.pop()
    }

    async protocCommand(): Promise<string[]> {
        let projectPlatform: Platform

        if (
            (await this.isFileExists('package.json')) &&
            !(await this.isFileExists('build.gradle')) &&
            !(await this.isFileExists('build.gradle.kts'))
        ) {
            projectPlatform = Platform.ts
        } else if ((await this.isFileExists('build.gradle')) || (await this.isFileExists('build.gradle.kts'))) {
            projectPlatform = Platform.java
        } else {
            throw new Error('Unable to identify platform type no package.json or build.gradle found')
        }

        let typesProtoPath: string
        let typesSubPaths: string[]
        let dependenciesPattern: string
        let designSystemProtoPath = ''

        switch (projectPlatform) {
            case Platform.java: {
                typesProtoPath = `./${this.javaModule ?? '.'}/build/extracted-protos/main/`
                typesSubPaths = [`${this.javaModule ?? '.'}`, 'build', 'extracted-protos', 'main']
                dependenciesPattern = `${this.javaModule ?? '.'}/build/extracted-protos/main/**/*.proto`
                execSync(`./gradlew ${this.javaModule ?? ''}:extractProto`, { stdio: 'pipe' })
                break
            }
            case Platform.ts: {
                typesProtoPath = './node_modules/@diia-inhouse/types/dist/proto/'
                typesSubPaths = ['dist', 'proto', '@diia-inhouse', 'types', 'design-system']
                designSystemProtoPath = './node_modules/@diia-inhouse/design-system/dist/proto'
                dependenciesPattern = 'node_modules/@diia-inhouse/**/proto/**/*.proto'
                break
            }
        }

        const pluginLocation = await this.getProtoTsPluginLocation()

        if (!pluginLocation) {
            throw new Error("Couldn't locate plugin in node modules. Are you sure that ts-proto is installed?")
        }

        const command = [
            'protoc',
            '--experimental_allow_proto3_optional',
            `--plugin=${pluginLocation}`,
            '--ts_proto_opt=useSnakeTypeName=false',
            '--ts_proto_opt=unrecognizedEnum=false',
            '--ts_proto_opt=stringEnums=true',
            '--ts_proto_opt=enumsAsLiterals=true',
            '--ts_proto_opt=exportCommonSymbols=true',
            '--ts_proto_opt=env=node',
            '--ts_proto_opt=esModuleInterop=true',
            '--ts_proto_opt=importSuffix=.js',
            '--ts_proto_opt=snakeToCamel=false',
            '--ts_proto_opt=useMongoObjectId=true',
            '--ts_proto_opt=useDate=true',
            '--ts_proto_opt=useExactTypes=false',
            `--ts_proto_out=${this.outputDir}`,
            `--proto_path ./${this.rootDir}`,
            `--proto_path ${typesProtoPath}`,
        ]

        if (designSystemProtoPath.length > 0) {
            command.push(`--proto_path ${designSystemProtoPath}`)
        }

        for (const protoPath of this.protoPaths) {
            command.push(`--proto_path ${protoPath}`)
        }

        if (this.generateClient) {
            command.push('--ts_proto_opt=outputServices=nice-grpc,outputServices=generic-definitions')
        } else {
            command.push('--ts_proto_opt=outputServices=false', '--ts_proto_opt=outputClientImpl=false')
        }

        const protosMap = await this.externalImports(dependenciesPattern, typesSubPaths, projectPlatform)
        for (const packageName in protosMap) {
            const subcommand = protosMap[packageName].map((proto) => `--ts_proto_opt=M${proto}=${packageName}`)

            command.push(...subcommand)
        }

        // Important, this should be the last param in argv array since it defines root file (strictly positional param)
        command.push(await this.iPath())

        return command
    }

    async postProcess(): Promise<void> {
        const files = await glob(path.join(this.outputDir, '**/*.ts'))

        for (const file of files) {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const content = await fs.readFile(file, 'utf8') // nosemgrep: eslint.detect-non-literal-fs-filename

            if (!content.includes('export namespace ')) {
                continue
            }

            const result = this.stripReservedWordTypeAliases(content)

            if (result !== content) {
                // eslint-disable-next-line security/detect-non-literal-fs-filename
                await fs.writeFile(file, result) // nosemgrep: eslint.detect-non-literal-fs-filename
            }
        }
    }

    private stripReservedWordTypeAliases(content: string): string {
        const lines = content.split('\n')
        const output: string[] = []
        let insideNamespace = false
        let namespaceStartIndex = -1
        let hasNonReservedMember = false

        for (const line of lines) {
            if (line.startsWith('export namespace ')) {
                insideNamespace = true
                namespaceStartIndex = output.length
                hasNonReservedMember = false
                output.push(line)

                continue
            }

            if (insideNamespace && line === '}') {
                insideNamespace = false

                if (hasNonReservedMember) {
                    output.push(line)
                } else {
                    output.splice(namespaceStartIndex)
                }

                continue
            }

            if (insideNamespace) {
                const match = line.match(/^\s*export type (\w+) = typeof /)

                if (match && reservedWords.has(match[1])) {
                    continue
                }

                hasNonReservedMember = true
            }

            output.push(line)
        }

        return output.join('\n')
    }

    private async isFileExists(file: string): Promise<boolean> {
        try {
            await fs.access(file, fs.constants.F_OK)
        } catch {
            return false
        }

        return true
    }
}
