export default class Logger {
    private readonly logEnabled: boolean

    constructor(logEnabled: boolean) {
        this.logEnabled = logEnabled
    }

    log(...message: string[]): void {
        // eslint-disable-next-line no-console
        console.log(...message)
    }

    logDebug(...message: string[]): void {
        if (!this.logEnabled) {
            return
        }

        // eslint-disable-next-line no-console
        console.log(...message)
    }
}
