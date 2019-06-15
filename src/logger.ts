
/**
 * A grouping of utility methods
 */
export class Logger {

  private static verbose = false;

  static setVerbose(isVerbose: boolean): void {
    Logger.verbose = isVerbose;
  }

  static getLogger(prefix: string): Logger {
    return new Logger(prefix);
  }

  private constructor(private prefix: string) { }

  /**
   * logs to the console, calling JSON.stringify on objects
   */
  info(...args: any[]) {
    console.log(this.prefix, args.map((argument: any) => typeof (argument === 'object') ? JSON.stringify(argument) : argument));
  }

  /**
   * calls log if isVerbose is true
   */
  verbose(...args: any[]) {
    if (Logger.verbose) {
      this.info(args);
    }
  }
}
