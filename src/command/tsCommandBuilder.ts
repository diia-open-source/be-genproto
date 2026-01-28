import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'

import { CommandBuilder, Platform } from './index'

export default class TsCommandBuilder extends CommandBuilder {
    // By default ts plugin should be linked to .bin dir but in case if it doesn't
    // try to look it up in "standard" locations
    private tsPluginLocations = [
        './node_modules/.bin/protoc-gen-ts_proto',
        './node_modules/ts-proto/protoc-gen-ts_proto',
        './node_modules/@diia-inhouse/genproto/node_modules/ts-proto/protoc-gen-ts_proto',
    ]

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
                typesProtoPath = './build/extracted-protos/main/'
                typesSubPaths = ['build', 'extracted-protos', 'main']
                dependenciesPattern = 'build/extracted-protos/main/**/*.proto'
                execSync('./gradlew :extractProto', { stdio: 'pipe' })
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
            '--ts_proto_opt=exportCommonSymbols=false',
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

        for (const protoPath in this.protoPaths) {
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

    private async isFileExists(file: string): Promise<boolean> {
        try {
            await fs.access(file, fs.constants.F_OK)
        } catch {
            return false
        }

        return true
    }
}
