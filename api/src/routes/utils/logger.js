const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 }
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info']

function format(level, msg, data) {
  const ts = new Date().toISOString()
  const base = `[${ts}] [${level.toUpperCase()}] ${msg}`
  return data ? `${base} ${JSON.stringify(data)}` : base
}

const logger = {
  error: (msg, data) => { if (CURRENT_LEVEL >= 0) console.error(format('error', msg, data)) },
  warn:  (msg, data) => { if (CURRENT_LEVEL >= 1) console.warn(format('warn',  msg, data)) },
  info:  (msg, data) => { if (CURRENT_LEVEL >= 2) console.log(format('info',   msg, data)) },
  debug: (msg, data) => { if (CURRENT_LEVEL >= 3) console.log(format('debug',  msg, data)) },
}

module.exports = logger
