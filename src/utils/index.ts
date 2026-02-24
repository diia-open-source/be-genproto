import syncFs, { promises as fs } from 'node:fs'
import path from 'node:path'
import { promises as readline } from 'node:readline'

/**
 * Extract exported symbol names from a ts-proto generated TypeScript file.
 * Returns arrays of value exports and type-only exports separately.
 * Names that exist as both value and type (e.g. interface + const with same name)
 * are only included in valueNames to avoid duplicate identifier errors.
 */
function extractExportedNames(content: string): { valueNames: string[]; typeNames: string[] } {
    const valueSet = new Set<string>()
    const typeSet = new Set<string>()

    // eslint-disable-next-line regexp/no-unused-capturing-group
    const exportRegex = /^export\s+(?:(const|let|var|function|enum|class)\s+(\w+)|(interface|type)\s+(\w+))/gm
    let match
    // eslint-disable-next-line no-cond-assign
    while ((match = exportRegex.exec(content)) !== null) {
        if (match[2]) {
            valueSet.add(match[2])
        } else if (match[4]) {
            typeSet.add(match[4])
        }
    }

    const pureTypeNames = [...typeSet].filter((n) => !valueSet.has(n))

    return { valueNames: [...valueSet], typeNames: pureTypeNames }
}

export default {
    async generateIndexForDirectory(dir: string, protoRoot = './proto'): Promise<void> {
        const exportLines: string[] = []
        const exportedNames = new Set<string>()

        const recursivePaths = async (realpath: string): Promise<string[]> => {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const items = await fs.readdir(realpath, { withFileTypes: true }) // nosemgrep: eslint.detect-non-literal-fs-filename
            let paths: string[] = []

            for (const item of items) {
                const resPath = path.resolve(realpath, item.name)

                if (item.isDirectory()) {
                    paths = [...paths, ...(await recursivePaths(resPath))]
                } else if (item.isFile() && item.name.endsWith('.ts') && item.name !== 'index.ts') {
                    paths = [...paths, resPath]
                }
            }

            return paths
        }

        for (const recPaths of await recursivePaths(dir)) {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const stream = syncFs.createReadStream(recPaths) // nosemgrep: eslint.detect-non-literal-fs-filename
            const rl = readline.createInterface({
                input: stream,
                crlfDelay: Infinity,
            })

            let ownPackage = false
            for await (const line of rl) {
                const matchArr = line.match(/^\/\/ source: (.+)$/)
                if (matchArr) {
                    const protoFile = matchArr[1]

                    const protofilepath = path.resolve(protoRoot, protoFile)
                    // prettier-ignore
                    // eslint-disable-next-line security/detect-non-literal-fs-filename
                    if (syncFs.existsSync(protofilepath)) { // nosemgrep: eslint.detect-non-literal-fs-filename
                        // eslint-disable-next-line security/detect-non-literal-fs-filename
                        const contents = await fs.readFile(protofilepath) // nosemgrep: eslint.detect-non-literal-fs-filename

                        ownPackage = contents.includes('package ua.gov.diia')
                    }
                }
            }

            const fileName = path.basename(recPaths, path.extname(recPaths))
            const parentDirName = path.basename(path.dirname(recPaths))
            const fileNameWithPrefix = path.join(parentDirName, fileName)

            const fileNameWithoutExt = path.basename(recPaths, '.ts')
            const relativePath = path.relative(dir, recPaths).replace('.ts', '.js')
            const relativeDir = path.dirname(relativePath)
            const importPath = relativeDir === '.' ? `./${fileNameWithoutExt}.js` : `./${relativePath}`

            if (ownPackage) {
                // Read file and extract exported names to avoid re-export conflicts (TS2308)
                // eslint-disable-next-line security/detect-non-literal-fs-filename
                const content = await fs.readFile(recPaths, 'utf8') // nosemgrep: eslint.detect-non-literal-fs-filename
                const { valueNames, typeNames } = extractExportedNames(content)

                const uniqueValues = valueNames.filter((n) => !exportedNames.has(n))
                const uniqueTypes = typeNames.filter((n) => !exportedNames.has(n))

                for (const name of [...uniqueValues, ...uniqueTypes]) {
                    exportedNames.add(name)
                }

                const parts: string[] = []
                if (uniqueValues.length > 0) {
                    parts.push(`export { ${uniqueValues.join(', ')} } from '${importPath}';`)
                }

                if (uniqueTypes.length > 0) {
                    parts.push(`export type { ${uniqueTypes.join(', ')} } from '${importPath}';`)
                }

                if (parts.length > 0) {
                    exportLines.push(parts.join('\n'))
                }
            } else {
                // eslint-disable-next-line unicorn/prefer-string-replace-all
                const namespace = fileNameWithPrefix.replace(/[/\\]/g, '_').replace(/[^\w$]/g, '_')

                exportLines.push(`export * as ${namespace} from '${importPath}';`)
            }
        }

        if (exportLines.length > 0) {
            const indexFilePath = path.join(dir, 'index.ts')

            // eslint-disable-next-line security/detect-non-literal-fs-filename
            await fs.writeFile(indexFilePath, exportLines.join('\n\n') + '\n') // nosemgrep: eslint.detect-non-literal-fs-filename
        }
    },
}
