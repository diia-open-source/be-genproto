import { CommandBuilder } from './index'

export default class JavaCommandBuilder extends CommandBuilder {
    async protocCommand(): Promise<string[]> {
        const command = [
            'protoc',
            '--experimental_allow_proto3_optional',
            `--java_out=${this.outputDir}`,
            '-I=./node_modules/@diia-inhouse/types/dist/proto/',
            `-I ./${this.rootDir} ${await this.iPath()}`,
        ]

        this.logger.log('java client build')

        return command
    }
}
