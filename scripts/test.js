// The public clean copy intentionally omits the private repository's test suite.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let tests;
try { tests = readdirSync(join(root, 'tests')).filter(name => name.endsWith('.test.js')).sort(); }
catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.error('Test suite is not included in the public clean copy; it runs in the working repository before publication.');
    process.exitCode = 1;
}
if (tests) {
    if (!tests.length) {
        console.error('No test files found; the test suite did not run.');
        process.exitCode = 1;
    } else {
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT; // Allow invoking the runner from another test process.
        const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests.map(name => join(root, 'tests', name))], { cwd: root, stdio: 'inherit', env });
        if (result.error) { console.error('Could not start the test suite:', result.error.message); process.exitCode = 1; }
        else if (result.signal) { console.error(`Test suite stopped by ${result.signal}.`); process.exitCode = 1; }
        else process.exitCode = result.status ?? 1;
    }
}
