import { execSync } from 'node:child_process'
import fs from 'node:fs'

import { CommandBuilder, Platform } from './index'

export default class TsCommandBuilder extends CommandBuilder {
    async protocCommand(): Promise<string[]> {
        let projectPlatform: Platform

        if (fs.existsSync('package.json') && !fs.existsSync('build.gradle')) {
            projectPlatform = Platform.ts
        } else if (fs.existsSync('build.gradle')) {
            projectPlatform = Platform.java
        } else {
            throw new Error('Unable to identify platform type no package.json or build.gradle found')
        }

        let typesProtoPath: string
        let typesSubPaths: string[]
        let dependenciesPattern: string

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
                typesSubPaths = ['dist', 'proto', '@diia-inhouse', 'types']
                dependenciesPattern = 'node_modules/@diia-inhouse/**/proto/**/*.proto'
                break
            }
        }

        const command = [
            'protoc',
            '--experimental_allow_proto3_optional',
            '--plugin=$(npm root)/.bin/protoc-gen-ts_proto',
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
            `-I ./${this.rootDir} ${await this.iPath()}`,
        ]

        command.push(`-I=${typesProtoPath}`)

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

        return command
    }
}
