type LoggerRegistry = { [key: string]: Logger };

/**
 * Logger interface
 */
export interface Logger {

  verbose: (...args: any[]) => void,
  info: (...args: any[]) => void,
  warn: (...args: any[]) => void,
  error: (...args: any[]) => void
}

/**
 * LoggerFactory creates Loggers
 */
export class LoggerFactory {

  private static instance: LoggerFactory;

  /**
   * Retrieves the singleton LoggerFactory
   * @param verbose Whether verbose logging should be enabled. 
   * This argument is only honored during the very first 
   * call within an application lifecycle, when the 
   * singleton is generated. Further calls to this method
   * do not modify the logging verbosity
   */
  static getInstance(verbose: boolean): LoggerFactory {
    if (!LoggerFactory.instance) {
      LoggerFactory.instance = new LoggerFactory(verbose);
    }
    return LoggerFactory.instance;
  }

  private loggers: LoggerRegistry = {};

  /**
   * Constructor
   * @param verbose Whether to generate Loggers with 
   * verbose logging enabled
   */
  constructor(private verbose: boolean) {
  }

  /**
   * Retrieves a Logger by id if it already exists, 
   * otherwise creates a new one
   * @param id The logger id for registration and 
   * construction purposes
   */
  getLogger(id: string): Logger {
    if (!this.loggers.hasOwnProperty(id)) {
      this.loggers[id] = new DefaultLogger(id, this.verbose);
    }
    return this.loggers[id];
  }
}

/**
 * The default implementation of the Logger interface
 */
class DefaultLogger implements Logger {

  /**
   * Constructor
   * @param prefix The id of the logger which gets prefixed in every log
   * @param enableVerbose Whether verbose logging should be enabled
   */
  constructor(private prefix: string, private enableVerbose: boolean) { }

  /**
   * Logs verbose content
   * @param args The content to log
   */
  verbose(...args: any[]): void {
    if (this.enableVerbose) {
      this.log(console.debug, args);
    }
  }

  /**
   * Logs info content
   * @param args The content to log
   */
  info(...args: any[]): void {
    this.log(console.log, args);
  }

  /**
   * Logs info content
   * @param args The content to log
   */
  warn(...args: any[]): void {
    this.log(console.warn, args);
  }

  /**
   * Logs info content
   * @param args The content to log
   */
  error(...args: any[]): void {
    this.log(console.error, args);
  }

  private log(method: (...args: any[]) => void, ...args: any[]): void {
    method.apply(console, [this.prefix].concat(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : `${arg}`)));
  }
}
