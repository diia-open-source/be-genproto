import fs from 'node:fs'
import path from 'node:path'

import { glob } from 'glob'

import Logger from '../logger'

export enum Platform {
    ts = 'ts',
    java = 'java',
}

export abstract class CommandBuilder {
    constructor(
        protected readonly logger: Logger,
        protected readonly generateClient: boolean,
        protected readonly rootDir: string,
        protected readonly outputDir: string,
        protected readonly protoPaths: string[],
    ) {}

    protected async iPath(): Promise<string> {
        let iPath = ''
        const protoFiles = await glob(`${this.rootDir}/**/*.proto`, { ignore: '**/node_modules/**' })

        if (protoFiles.length > 0) {
            iPath += ' ' + protoFiles.join(' ')
        }

        return iPath.trim()
    }

    protected async externalImports(
        dependenciesPattern: string,
        subpaths: string[],
        platform: Platform,
    ): Promise<{ [key: string]: string[] }> {
        let files: string[] = await glob(dependenciesPattern)

        if (!files) {
            return {}
        }

        if (dependenciesPattern.includes('node_modules')) {
            files = files.filter((file) => {
                const pathParts = file.split('/')

                if (pathParts.filter((part) => part === 'node_modules').length > 1) {
                    return false
                }

                return true
            })
        }

        return files.reduce?.<{ [key: string]: string[] }>((acc, value) => {
            const ext = path.extname(value)

            if (ext !== '.proto') {
                return acc
            }

            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const contents = fs.readFileSync(value) // nosemgrep: eslint.detect-non-literal-fs-filename
            if (!contents.includes('package ua.gov.diia')) {
                return acc
            }

            const splittedPath = value.split('/')
            const idx = splittedPath.indexOf('node_modules')
            const packageName = platform === Platform.java ? '@diia-inhouse/types' : `${splittedPath[idx + 1]}/${splittedPath[idx + 2]}`

            const filename = splittedPath
                .slice(idx + 1)
                .filter((subpath) => !subpaths.includes(subpath) || subpath.endsWith('.proto'))
                .join('/')

            return { ...acc, [packageName]: [filename, ...(acc[packageName] || [])] }
        }, {})
    }

    abstract protocCommand(): Promise<string[]>
}
