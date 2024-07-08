#! /usr/bin/env node

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { lookpath } from 'lookpath'
import yargs from 'yargs'

import { CommandBuilder, Platform } from './command'
import JavaCommandBuilder from './command/javaCommandBuilder'
import TsCommandBuilder from './command/tsCommandBuilder'
import Logger from './logger'
import Utils from './utils'

async function main(): Promise<void> {
    const protocExists = await lookpath('protoc')

    if (!protocExists) {
        throw new Error("Couldn't find protoc in PATH")
    }

    const options = await yargs
        .usage('$0 --rootDir dirname --outputDir dirname')
        .option('v', { type: 'boolean', default: false })
        .option('platform', { type: 'string', default: Platform.ts })
        .option('generateClient', { type: 'boolean', default: false })
        .option('rootDir', { type: 'string', default: 'proto' })
        .option('outputDir', { type: 'string', default: 'src/generated' })
        .option('indexToDirs', {
            type: 'array',
            describe: 'A list of directory paths where [index.ts] files should be generated, including all subdirectories.',
        }).argv
    const { v, platform, generateClient, rootDir, outputDir, indexToDirs = [outputDir] } = options
    const logger = new Logger(v)
    const outputAbsoluteDir = path.resolve(outputDir)

    try {
        await fs.promises.access(outputAbsoluteDir)
        logger.log(`Removing directory ${outputAbsoluteDir}...`)
        await fs.promises.rm(outputAbsoluteDir, { recursive: true })
    } catch {
        logger.log(`Directory ${outputAbsoluteDir} doesn't exist`)
    }

    logger.log(`Creating directory ${outputAbsoluteDir}...`)
    await fs.promises.mkdir(options.outputDir, { recursive: true })

    let commandBuilder: CommandBuilder

    switch (platform) {
        case Platform.java: {
            commandBuilder = new JavaCommandBuilder(logger, generateClient, rootDir, outputDir)
            break
        }
        case Platform.ts: {
            commandBuilder = new TsCommandBuilder(logger, generateClient, rootDir, outputDir)
            break
        }
        default: {
            throw new Error(`Unexpected platform: ${platform}`)
        }
    }

    const command = await commandBuilder.protocCommand()

    logger.logDebug(command.join(' '))

    try {
        // ignore stdout but print stderr in exception handler
        execSync(command.join(' '), { stdio: 'pipe' })
        if (indexToDirs.length > 0) {
            logger.log('Start to generate index files...')
            for (const dir of indexToDirs) {
                try {
                    const indexDir = path.resolve(<string>dir)

                    await fs.promises.access(indexDir)
                    logger.log(`Generating index.ts for directory: ${indexDir}`)
                    await Utils.generateIndexForDirectory(indexDir)
                } catch (err) {
                    logger.log(`Error processing directory ${dir}: ${err}`)
                }
            }
        }
    } catch (err_: unknown) {
        const err = <{ stderr: Buffer; stack: never }>err_

        logger.log('Command failed: ', err.stderr?.toString())
        logger.log(err.stack)
    }

    logger.log('Protoc command finished successfully')
}

main()
