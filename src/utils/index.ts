import syncFs, { promises as fs } from 'node:fs'
import path from 'node:path'
import { promises as readline } from 'node:readline'

export default {
    async generateIndexForDirectory(dir: string, protoRoot = './proto'): Promise<void> {
        const exports: string[] = []

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
                exports.push(`export * from '${importPath}';`)
            } else {
                exports.push(`export * as '${fileNameWithPrefix}' from '${importPath}';`)
            }
        }

        if (exports.length > 0) {
            const indexFilePath = path.join(dir, 'index.ts')

            // eslint-disable-next-line security/detect-non-literal-fs-filename
            await fs.writeFile(indexFilePath, exports.join('\n\n') + '\n') // nosemgrep: eslint.detect-non-literal-fs-filename
        }
    },
}
