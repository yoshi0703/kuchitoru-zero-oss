import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) await copyDirectory(from, to)
    else if (entry.isFile()) await writeFile(to, await readFile(from))
  }
}

await copyDirectory(path.join(root, 'public'), path.join(root, 'dist'))
console.log('Copied public assets into dist')
