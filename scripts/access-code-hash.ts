/**
 * Make the fingerprint of an access code for `ACCESS_CODE_HASHES` in apps/mobile/src/config.ts.
 * Run `pnpm access-code-hash` and type the code at the prompt (it isn't echoed or saved anywhere).
 * Put only the printed fingerprint in the config; keep the code itself private (Play Console's App
 * access instructions, your own notes).
 */
import { createHash } from 'node:crypto';
import { stdin, stdout } from 'node:process';
import { ACCESS_CODE_MIN_LENGTH, accessCodeInput } from '../packages/core/src/accessCode';

async function readHidden(prompt: string): Promise<string> {
  stdout.write(prompt);
  if (!stdin.isTTY) {
    let data = '';
    for await (const chunk of stdin) data += chunk;
    return data.trim();
  }
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  return new Promise((resolve, reject) => {
    stdin.on('data', (ch: string) => {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); resolve(value); }
      else if (ch === '\u0003') { stdin.setRawMode(false); reject(new Error('cancelled')); }
      else if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
      else value += ch;
    });
  });
}

const code = await readHidden('Access code (hidden): ');
const plain = code.replace(/[\s-]+/g, '');
if (plain.length < ACCESS_CODE_MIN_LENGTH) {
  console.error(`Use at least ${ACCESS_CODE_MIN_LENGTH} letters and numbers (16 or more random characters is better): the fingerprint is public, so a short code can be guessed.`);
  process.exit(1);
}
console.log(createHash('sha256').update(accessCodeInput(code), 'utf8').digest('hex'));
