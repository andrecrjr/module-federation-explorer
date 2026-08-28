const fs = require('fs');

const marker = `.ui-${process.argv[2]}.started`;
fs.writeFileSync(marker, new Date().toISOString());
setInterval(() => {}, 1000);
