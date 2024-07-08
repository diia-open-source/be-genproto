import { promises as fs } from 'node:fs'
import path from 'node:path'

export default {
    async generateIndexForDirectory(dir: string): Promise<void> {
        const items = await fs.readdir(dir, { withFileTypes: true })
        const exports: string[] = []

        for (const item of items) {
            const resPath = path.resolve(dir, item.name)
            if (item.isDirectory()) {
                await this.generateIndexForDirectory(resPath)
                exports.push(`export * from './${item.name}/index.js';`)
            } else if (item.isFile() && item.name.endsWith('.ts') && item.name !== 'index.ts') {
                const fileNameWithoutExt = path.basename(item.name, '.ts')

                exports.push(`export * from './${fileNameWithoutExt}.js';`)
            }
        }

        if (exports.length > 0) {
            const indexFilePath = path.join(dir, 'index.ts')

            await fs.writeFile(indexFilePath, exports.join('\n\n') + '\n')
        }
    },
}
