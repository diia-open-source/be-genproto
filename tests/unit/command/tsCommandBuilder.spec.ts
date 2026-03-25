/* eslint-disable security/detect-non-literal-fs-filename */
import fs from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TsCommandBuilder from '../../../src/command/tsCommandBuilder'
import Logger from '../../../src/logger'

describe('TsCommandBuilder', () => {
    describe('method: `postProcess`', () => {
        const outputDir = path.join(process.env.TMPDIR ?? '/tmp', 'genproto-test-output')
        const logger = new Logger(false)
        const builder = new TsCommandBuilder(logger, false, 'proto', outputDir, [])

        beforeEach(async () => {
            // nosemgrep: eslint.detect-non-literal-fs-filename
            await fs.mkdir(outputDir, { recursive: true })
        })

        afterEach(async () => {
            await fs.rm(outputDir, { recursive: true, force: true })
        })

        it('should remove reserved word type aliases from namespace', async () => {
            const input = [
                'export const Icon = { add: "add", delete: "delete" } as const;',
                '',
                'export type Icon = typeof Icon[keyof typeof Icon];',
                '',
                'export namespace Icon {',
                '  export type add = typeof Icon.add;',
                '  export type delete = typeof Icon.delete;',
                '}',
            ].join('\n')

            // nosemgrep: eslint.detect-non-literal-fs-filename
            await fs.writeFile(path.join(outputDir, 'icon.ts'), input)

            await builder.postProcess()

            // nosemgrep: eslint.detect-non-literal-fs-filename
            const result = await fs.readFile(path.join(outputDir, 'icon.ts'), 'utf8')

            expect(result).toContain('export type add = typeof Icon.add;')
            expect(result).not.toContain('export type delete = typeof Icon.delete;')
            expect(result).toContain('export namespace Icon {')
        })

        it('should remove entire namespace when all members are reserved words', async () => {
            const input = [
                'export const Ops = { delete: "delete", new: "new" } as const;',
                '',
                'export type Ops = typeof Ops[keyof typeof Ops];',
                '',
                'export namespace Ops {',
                '  export type delete = typeof Ops.delete;',
                '  export type new = typeof Ops.new;',
                '}',
            ].join('\n')

            // nosemgrep: eslint.detect-non-literal-fs-filename
            await fs.writeFile(path.join(outputDir, 'ops.ts'), input)

            await builder.postProcess()

            // nosemgrep: eslint.detect-non-literal-fs-filename
            const result = await fs.readFile(path.join(outputDir, 'ops.ts'), 'utf8')

            expect(result).not.toContain('export namespace Ops')
            expect(result).not.toContain('export type delete')
            expect(result).not.toContain('export type new')
            expect(result).toContain('export const Ops')
        })

        it('should not modify files without namespaces', async () => {
            const input = ['export const Foo = { bar: "bar" } as const;', '', 'export type Foo = typeof Foo[keyof typeof Foo];'].join('\n')

            // nosemgrep: eslint.detect-non-literal-fs-filename
            await fs.writeFile(path.join(outputDir, 'foo.ts'), input)
            const writeSpy = vi.spyOn(fs, 'writeFile')

            await builder.postProcess()

            expect(writeSpy).not.toHaveBeenCalled()
            writeSpy.mockRestore()
        })

        it('should not modify namespaces without reserved words', async () => {
            const input = [
                'export const Status = { success: "success", fail: "fail" } as const;',
                '',
                'export type Status = typeof Status[keyof typeof Status];',
                '',
                'export namespace Status {',
                '  export type success = typeof Status.success;',
                '  export type fail = typeof Status.fail;',
                '}',
            ].join('\n')

            // nosemgrep: eslint.detect-non-literal-fs-filename
            await fs.writeFile(path.join(outputDir, 'status.ts'), input)

            await builder.postProcess()

            // nosemgrep: eslint.detect-non-literal-fs-filename
            const result = await fs.readFile(path.join(outputDir, 'status.ts'), 'utf8')

            expect(result).toBe(input)
        })

        it('should handle multiple namespaces in one file', async () => {
            const input = [
                'export namespace Safe {',
                '  export type foo = typeof Safe.foo;',
                '}',
                '',
                'export namespace Unsafe {',
                '  export type delete = typeof Unsafe.delete;',
                '  export type bar = typeof Unsafe.bar;',
                '}',
                '',
                'export namespace AllReserved {',
                '  export type return = typeof AllReserved.return;',
                '}',
            ].join('\n')

            // nosemgrep: eslint.detect-non-literal-fs-filename
            await fs.writeFile(path.join(outputDir, 'multi.ts'), input)

            await builder.postProcess()

            // nosemgrep: eslint.detect-non-literal-fs-filename
            const result = await fs.readFile(path.join(outputDir, 'multi.ts'), 'utf8')

            expect(result).toContain('export namespace Safe {')
            expect(result).toContain('export type foo = typeof Safe.foo;')
            expect(result).toContain('export namespace Unsafe {')
            expect(result).toContain('export type bar = typeof Unsafe.bar;')
            expect(result).not.toContain('export type delete')
            expect(result).not.toContain('export namespace AllReserved')
            expect(result).not.toContain('export type return')
        })

        it('should handle all reserved words', async () => {
            const reservedWords = [
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
            ]

            for (const word of reservedWords) {
                const input = [
                    `export namespace Test {`,
                    `  export type ${word} = typeof Test.${word};`,
                    `  export type safe = typeof Test.safe;`,
                    `}`,
                ].join('\n')

                // nosemgrep: eslint.detect-non-literal-fs-filename
                await fs.writeFile(path.join(outputDir, `reserved-${word}.ts`), input)
            }

            await builder.postProcess()

            for (const word of reservedWords) {
                // nosemgrep: eslint.detect-non-literal-fs-filename
                const result = await fs.readFile(path.join(outputDir, `reserved-${word}.ts`), 'utf8')

                expect(result, `reserved word "${word}" should be stripped`).not.toContain(`export type ${word} =`)
                expect(result).toContain('export type safe = typeof Test.safe;')
            }
        })

        it('should preserve code outside namespaces', async () => {
            const input = [
                'import { Something } from "./other.js";',
                '',
                'export const Icon = { delete: "delete", add: "add" } as const;',
                '',
                'export type Icon = typeof Icon[keyof typeof Icon];',
                '',
                'export namespace Icon {',
                '  export type delete = typeof Icon.delete;',
                '  export type add = typeof Icon.add;',
                '}',
                '',
                'export function iconFromJSON(object: any): Icon {',
                '  return object;',
                '}',
            ].join('\n')

            // nosemgrep: eslint.detect-non-literal-fs-filename
            await fs.writeFile(path.join(outputDir, 'preserve.ts'), input)

            await builder.postProcess()

            // nosemgrep: eslint.detect-non-literal-fs-filename
            const result = await fs.readFile(path.join(outputDir, 'preserve.ts'), 'utf8')

            expect(result).toContain('import { Something } from "./other.js";')
            expect(result).toContain('export const Icon = { delete: "delete", add: "add" } as const;')
            expect(result).toContain('export function iconFromJSON(object: any): Icon {')
            expect(result).toContain('export type add = typeof Icon.add;')
            expect(result).not.toContain('export type delete = typeof Icon.delete;')
        })
    })
})
