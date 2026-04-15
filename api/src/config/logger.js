const ts = () => new Date().toISOString()

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
}

module.exports = {
  info:  (...a) => console.log(`${colors.dim}[${ts()}]${colors.reset} ${colors.green}[INFO]${colors.reset}`, ...a),
  warn:  (...a) => console.warn(`${colors.dim}[${ts()}]${colors.reset} ${colors.yellow}[WARN]${colors.reset}`, ...a),
  error: (...a) => console.error(`${colors.dim}[${ts()}]${colors.reset} ${colors.red}[ERROR]${colors.reset}`, ...a),
  debug: (...a) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`${colors.dim}[${ts()}]${colors.reset} ${colors.cyan}[DEBUG]${colors.reset}`, ...a)
    }
  },
  req: (method, path, status, ms) => {
    const color = status >= 500 ? colors.red : status >= 400 ? colors.yellow : colors.green
    console.log(`${colors.dim}[${ts()}]${colors.reset} ${color}${method} ${path} ${status}${colors.reset} ${colors.dim}${ms}ms${colors.reset}`)
  }
}
