import path from 'path'
import { resolveTsProtoPluginPath } from '../../src/command/tsCommandBuilder'

describe('Ts Command Builder', () => {
    it('should propose plugin absolute path with process cwd', async () => {
        // GIVEN, WHEN: resolve plugin path with process cwd
        const result = await resolveTsProtoPluginPath()

        // THEN: plugin path should be found
        expect(result).toContain(path.join('be-genproto', 'node_modules', '.bin', 'protoc-gen-ts_proto'))
    })

    it('should propose plugin absolute path with custom cwd', async () => {
        // GIVEN: start from node_modules/.bin directory
        const cwd = path.resolve(path.join(__dirname, '..', '..', 'node_modules', '.bin'))

        // WHEN: resolve plugin path
        const result = await resolveTsProtoPluginPath({ cwd })

        // THEN: plugin path should be found
        expect(result).toContain(path.join('be-genproto', 'node_modules', '.bin', 'protoc-gen-ts_proto'))
    })
})
