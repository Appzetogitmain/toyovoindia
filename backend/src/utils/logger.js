import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          const time = new Date(timestamp).toTimeString().split(' ')[0];
          return `${time} [${level}]: ${message}`;
        }) 
      )
    }),
    new winston.transports.File({ 
      filename: 'backend-errors.log', 
      level: 'error',
      dirname: './backend/logs'
    })
  ]
});

export default logger;
