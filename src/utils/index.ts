import { once } from 'node:events'
import syncFs, { promises as fs } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'

interface ExportedNames {
    valueNames: string[]
    typeNames: string[]
}

/**
 * Extract exported symbol names from a ts-proto generated TypeScript file.
 * Returns arrays of value exports and type-only exports separately.
 * Names that exist as both value and type (e.g. interface + const with same name)
 * are only included in valueNames to avoid duplicate identifier errors.
 */
function extractExportedNames(content: string): ExportedNames {
    const valueSet = new Set<string>()
    const typeSet = new Set<string>()

    const exportRegex = /^export\s+(?:(?:const|let|var|function|enum|class)\s+(\w+)|(?:interface|type)\s+(\w+))/gm

    for (const match of content.matchAll(exportRegex)) {
        if (match[1]) {
            valueSet.add(match[1])
        } else if (match[2]) {
            typeSet.add(match[2])
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
            const stream = syncFs.createReadStream(recPaths) // nosemgrep: eslint.detect-non-literal-fs-filename
            const rl = createInterface({
                input: stream,
                crlfDelay: Infinity,
            })

            let ownPackage = false

            rl.on('line', (line) => {
                const matchArr = line.match(/^\/\/ source: (.+)$/)
                if (matchArr) {
                    const protoFile = matchArr[1]

                    const protofilepath = path.resolve(protoRoot, protoFile)
                    const exists = syncFs.existsSync(protofilepath) // nosemgrep: eslint.detect-non-literal-fs-filename
                    if (exists) {
                        const contents = syncFs.readFileSync(protofilepath) // nosemgrep: eslint.detect-non-literal-fs-filename

                        ownPackage = contents.includes('package ua.gov.diia')
                    }
                }
            })

            await once(rl, 'close')
            stream.destroy()

            const fileName = path.basename(recPaths, path.extname(recPaths))
            const parentDirName = path.basename(path.dirname(recPaths))
            const fileNameWithPrefix = path.join(parentDirName, fileName)

            const fileNameWithoutExt = path.basename(recPaths, '.ts')
            const relativePath = path.relative(dir, recPaths).replace('.ts', '.js')
            const relativeDir = path.dirname(relativePath)
            const importPath = relativeDir === '.' ? `./${fileNameWithoutExt}.js` : `./${relativePath}`

            if (ownPackage) {
                // Read file and extract exported names to avoid re-export conflicts (TS2308)
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
                const namespace = fileNameWithPrefix.replace(/[/\\]/g, '_').replace(/[^\w$]/g, '_')

                exportLines.push(`export * as ${namespace} from '${importPath}';`)
            }
        }

        if (exportLines.length > 0) {
            const indexFilePath = path.join(dir, 'index.ts')

            await fs.writeFile(indexFilePath, `${exportLines.join('\n\n')}\n`) // nosemgrep: eslint.detect-non-literal-fs-filename
        }
    },
}
