const logger = {
    info: (obj, msg) => console.log(JSON.stringify({ level: 'info', ...obj, msg, time: new Date().toISOString() })),
    error: (obj, msg) => console.error(JSON.stringify({ level: 'error', ...obj, msg, time: new Date().toISOString() })),
    warn: (obj, msg) => console.warn(JSON.stringify({ level: 'warn', ...obj, msg, time: new Date().toISOString() })),
    debug: (obj, msg) => console.debug(JSON.stringify({ level: 'debug', ...obj, msg, time: new Date().toISOString() })),
};

export default logger;
