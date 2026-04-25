import { emitKeypressEvents } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

export async function prompt(question: string): Promise<string> {
  output.write(question);

  if (!input.isTTY) {
    return new Promise<string>((resolve) => {
      let buffer = '';
      input.setEncoding('utf8');
      input.once('data', (chunk) => {
        buffer += chunk;
        resolve(buffer.trim());
      });
    });
  }

  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  return new Promise<string>((resolve, reject) => {
    let value = '';

    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.off('keypress', onKeypress);
      output.write('\n');
    };

    const onKeypress = (str: string, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Prompt cancelled.'));
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(value.trim());
        return;
      }

      if (key.name === 'backspace') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          output.write('\b \b');
        }
        return;
      }

      if (typeof str === 'string' && str.length > 0 && !key.ctrl) {
        value += str;
        output.write('*');
      }
    };

    input.on('keypress', onKeypress);
  });
}

export async function promptApiKey(): Promise<string> {
  return prompt('Paste your Lamina API key: ');
}
