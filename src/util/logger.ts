/**
 * Logger interface
 */
export interface Logger {

  info: (...args: any[]) => Logger,
  verbose: (...args: any[]) => Logger
}

/**
 * LoggerFactory creates Loggers
 */
export class LoggerFactory implements Logger {

  private static DEFAULT_LOGGER = "main";
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

    /* create a new default logger */
    this.loggers[LoggerFactory.DEFAULT_LOGGER] = new DefaultLogger(LoggerFactory.DEFAULT_LOGGER, enableVerbose);
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

  /**
   * Convenience method that logs info content to the default logger
   * @param args The content to log
   */
  info(...args: any[]): LoggerFactory {
    this.loggers[LoggerFactory.DEFAULT_LOGGER].info(args);
    return this;
  }

  /**
   * Convenience method that logs verbose content to the default logger
   * @param args The content to log
   */
  verbose(...args: any[]): LoggerFactory {
    this.loggers[LoggerFactory.DEFAULT_LOGGER].verbose(args);
    return this;
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
   * Logs info content
   * @param args The content to log
   */
  info(...args: any[]): Logger {
    console.log(this.prefix, args.map((argument: any) => typeof (argument === 'object') ? JSON.stringify(argument) : argument));
    return this;
  }

  /**
   * Logs verbose content
   * @param args The content to log
   */
  verbose(...args: any[]): Logger {
    if (this.enableVerbose) {
      this.info(args);
    }
    return this;
  }
}
