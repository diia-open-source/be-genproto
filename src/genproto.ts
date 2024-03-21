#! /usr/bin/env node
/* eslint-disable node/shebang */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import process from 'process'
import os from 'os'

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
        .option('rootDir', { type: 'string', default: 'node_modules/@diia-inhouse/**/proto/**/*.proto' })
        .option('outputDir', { type: 'string', default: 'src/interfaces' })
        .option('indexToDirs', {
            type: 'array',
            default: ['src/generated'],
            describe: 'A list of directory paths where [index.ts] files should be generated, including all subdirectories.',
        }).argv

    const logger = new Logger(options.v)

    const outputDir = path.resolve(options.outputDir)

    try {
        await fs.promises.access(outputDir)
        logger.log(`Removing directory ${outputDir}...`)
        await fs.promises.rm(outputDir, { recursive: true })
    } catch (err) {
        logger.log(`Directory ${outputDir} doesn't exist`)
    }

    logger.log(`Creating directory ${outputDir}...`)
    await fs.promises.mkdir(options.outputDir, { recursive: true })

    const platform: Platform = Platform[<keyof typeof Platform>options.platform]
    const generateClient = options.generateClient

    let commandBuilder: CommandBuilder

    switch (platform) {
        case Platform.java:
            commandBuilder = new JavaCommandBuilder(logger, generateClient, options.outputDir)
            break
        case Platform.ts:
            commandBuilder = new TsCommandBuilder(logger, generateClient, options.outputDir)
            break
    }

    const command = await commandBuilder.protocCommand()

    logger.log(command.join(' '))

    try {
        let commandLine = command.join(' ');
        if (process.platform === 'win32') {
            const tempFile = path.join(os.tmpdir(), 'genproto.cmd');
            fs.writeFileSync(tempFile, commandLine);
            commandLine = tempFile
        }

        // ignore stdout but print stderr in exception handler
        execSync(commandLine, { stdio: 'pipe' })
        if (options.indexToDirs.length) {
            logger.log('Start to generate index files...')
            for (const dir of options.indexToDirs) {
                try {
                    const indexDir = path.resolve(<string>dir)

                    await fs.promises.access(indexDir)
                    logger.log(`Generating index.ts for directory: ${indexDir}`)
                    await Utils.generateIndexForDirectory(indexDir)
                } catch (error) {
                    logger.log(`Error processing directory ${dir}: ${error}`)
                }
            }
        }
    } catch (e: unknown) {
        const err = <{ stderr: Buffer; stack: never }>e

        logger.log('Command failed: ', err.stderr?.toString())
        logger.log(err.stack)
    } finally {
        if (process.platform === 'win32') {
            const tempFile = path.join(os.tmpdir(), 'genproto.cmd');
            fs.rmSync(tempFile);
        }
    }

    logger.log('Protoc command finished successfully')
}

main()
