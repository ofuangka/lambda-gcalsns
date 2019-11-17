/**
 * Logger interface
 */
export interface Logger {

  verbose: (...args: any[]) => Logger,
  info: (...args: any[]) => Logger,
  warn: (...args: any[]) => Logger,
  error: (...args: any[]) => Logger
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
   * do not modify the verbosity
   */
  static getInstance(verbose: boolean): LoggerFactory {
    if (!LoggerFactory.instance) {
      LoggerFactory.instance = new LoggerFactory(verbose);
    }
    return LoggerFactory.instance;
  }

  private loggers: { [key: string]: Logger } = {};

  /**
   * Constructor
   * @param enableVerbose Whether to generate Loggers with 
   * verbose logging enabled
   */
  constructor(private enableVerbose: boolean) {
  }

  /**
   * Retrieves a Logger by id if it already exists, 
   * otherwise creates a new one
   * @param id The logger id for registration and 
   * construction purposes
   */
  getLogger(id: string): Logger {
    if (!this.loggers.hasOwnProperty(id)) {
      this.loggers[id] = new DefaultLogger(id, this.enableVerbose);
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
  verbose(...args: any[]): Logger {
    if (this.enableVerbose) {
      console.debug(this.prefix, args.map((argument) => typeof (argument === 'object') ? JSON.stringify(argument) : argument));
    }
    return this;
  }

  /**
   * Logs info content
   * @param args The content to log
   */
  info(...args: any[]): Logger {
    console.log(this.prefix, args.map((argument) => typeof (argument === 'object') ? JSON.stringify(argument) : argument));
    return this;
  }

  /**
   * Logs info content
   * @param args The content to log
   */
  warn(...args: any[]): Logger {
    console.warn(this.prefix, args.map((argument) => typeof (argument === 'object') ? JSON.stringify(argument) : argument));
    return this;
  }

  /**
   * Logs info content
   * @param args The content to log
   */
  error(...args: any[]): Logger {
    console.error(this.prefix, args.map((argument) => typeof (argument === 'object') ? JSON.stringify(argument) : argument));
    return this;
  }
}
