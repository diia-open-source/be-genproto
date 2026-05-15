export default class Logger {
    private readonly logEnabled: boolean

    constructor(logEnabled: boolean) {
        this.logEnabled = logEnabled
    }

    log(...message: string[]): void {
        // oxlint-disable-next-line eslint/no-console
        console.log(...message)
    }

    logDebug(...message: string[]): void {
        if (!this.logEnabled) {
            return
        }

        // oxlint-disable-next-line eslint/no-console
        console.log(...message)
    }
}
