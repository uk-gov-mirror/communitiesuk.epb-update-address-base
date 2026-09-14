import { Console } from 'node:console';
import { PassThrough } from 'node:stream';
import { beforeEach, jest, describe, test, expect } from '@jest/globals';
import dedent from 'dedent';
import { http, HttpResponse } from 'msw';
import { createProgram } from '../lib/program.mjs';
import { resetDatabase, runQuery } from './support/database-helpers.mjs';
import { server } from './support/mock-server.mjs';

beforeEach(() => resetDatabase());

async function captureLogs(fn) {
  // We will capture the log output by redirecting console.log into an
  // isolated Console, and writing that to a string
  let logs = '';
  const stream = new PassThrough().on(
    'data',
    (chunk) => (logs += chunk.toString()),
  );
  const isolatedConsole = new Console({
    stdout: stream,
    stderr: stream,
    colorMode: false,
  });
  const spyLog = jest
    .spyOn(console, 'log')
    .mockImplementation((...args) => isolatedConsole.log(...args));
  const spyError = jest
    .spyOn(console, 'error')
    .mockImplementation((...args) => isolatedConsole.log(...args));
  // Discard
  const spyTime = jest.spyOn(console, 'timeEnd').mockImplementation(() => {});

  await fn();

  spyLog.mockRestore();
  spyError.mockRestore();
  spyTime.mockRestore();

  return logs;
}

describe('install', () => {
  test('installs the latest version', async () => {
    const logs = await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install'], { from: 'user' });
    });

    expect(logs.trim()).toEqual(dedent`
      Installed version AddressBase Plus 03.07.2026
      { inserts: 25, updates: 0, deletes: 0 }
    `);

    expect(
      await runQuery('SELECT * FROM address_base ORDER BY uprn'),
    ).toMatchSnapshot();
    expect(
      await runQuery(
        'SELECT version_name, version_number FROM address_base_versions ORDER BY created_at',
      ),
    ).toEqual([
      { version_name: 'AddressBase Plus 03.07.2026', version_number: 20637 },
    ]);
  });

  test('installs a specific version', async () => {
    const logs = await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install', 'E127 May 2026 Update'], {
        from: 'user',
      });
    });

    expect(logs.trim()).toEqual(dedent`
       Installed version E127 May 2026 Update
       { inserts: 19, updates: 0, deletes: 0 }
    `);

    expect(
      await runQuery('SELECT * FROM address_base ORDER BY uprn'),
    ).toMatchSnapshot();
    expect(
      await runQuery(
        'SELECT version_name, version_number FROM address_base_versions ORDER BY created_at',
      ),
    ).toEqual([{ version_name: 'E127 May 2026 Update', version_number: 127 }]);
  });

  test('replaces an existing version', async () => {
    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install'], {
        from: 'user',
      });
    });

    const originalAddresses = await runQuery(
      'SELECT * FROM address_base ORDER BY uprn',
    );

    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install', 'E127 May 2026 Update'], {
        from: 'user',
      });
    });

    const legacyAddresses = await runQuery(
      'SELECT * FROM address_base_legacy ORDER BY uprn',
    );
    expect(legacyAddresses).toEqual(originalAddresses);
    expect(
      await runQuery("SELECT to_regclass('address_base_tmp') AS table_name"),
    ).toEqual([{ table_name: null }]);
    expect(
      await runQuery(
        'SELECT version_name, version_number FROM address_base_versions ORDER BY created_at',
      ),
    ).toEqual([{ version_name: 'E127 May 2026 Update', version_number: 127 }]);
  });

  test('errors if the version does not exist', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    const logs = await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install', 'xxx'], {
        from: 'user',
      });
    });

    expect(logs.trim()).toEqual(dedent`
      Cannot find version xxx
    `);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('update', () => {
  test('updates to a specific version', async () => {
    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install', 'E127 May 2026 Update'], {
        from: 'user',
      });
    });
    const originalAddresses = await runQuery(
      'SELECT * FROM address_base ORDER BY uprn',
    );

    const logs = await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['update', 'E128 June 2026 Update'], {
        from: 'user',
      });
    });

    expect(logs.trim()).toEqual(dedent`
       Updated to version E128 June 2026 Update
       { inserts: 4, updates: 2, deletes: 8 }
    `);

    expect(
      await runQuery('SELECT * FROM address_base ORDER BY uprn'),
    ).toMatchSnapshot();
    expect(
      await runQuery(
        'SELECT version_name, version_number FROM address_base_versions ORDER BY created_at',
      ),
    ).toEqual([
      { version_name: 'E127 May 2026 Update', version_number: 127 },
      { version_name: 'E128 June 2026 Update', version_number: 128 },
    ]);
    expect(
      await runQuery('SELECT * FROM address_base_legacy ORDER BY uprn'),
    ).toEqual(originalAddresses);
  });

  test('updates to the latest version', async () => {
    // Install older version
    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install', 'E127 May 2026 Update'], {
        from: 'user',
      });
    });

    const logs = await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['update'], {
        from: 'user',
      });
    });

    expect(logs.trim()).toEqual(dedent`
       Updated to version AddressBase Plus 03.07.2026
       { inserts: 8, updates: 3, deletes: 9 }
    `);
    expect(
      await runQuery('SELECT * FROM address_base ORDER BY uprn'),
    ).toMatchSnapshot();
    expect(
      await runQuery(
        'SELECT version_name, version_number FROM address_base_versions ORDER BY created_at',
      ),
    ).toEqual([
      { version_name: 'E127 May 2026 Update', version_number: 127 },
      { version_name: 'E128 June 2026 Update', version_number: 128 },
      { version_name: 'AddressBase Plus 03.07.2026', version_number: 20637 },
    ]);
  });

  test('latest version matches updating a previous version', async () => {
    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install'], {
        from: 'user',
      });
    });

    const fullAddresses = await runQuery(
      'SELECT * FROM address_base ORDER BY uprn',
    );

    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install', 'E127 May 2026 Update'], {
        from: 'user',
      });
    });

    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['update'], {
        from: 'user',
      });
    });

    const updatedAddresses = await runQuery(
      'SELECT * FROM address_base ORDER BY uprn',
    );

    expect(updatedAddresses).toEqual(fullAddresses);
  });

  test('copies the old data to address_base_legacy and deletes address_base_temp', async () => {
    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install', 'E127 May 2026 Update'], {
        from: 'user',
      });
    });

    const originalAddresses = await runQuery(
      'SELECT * FROM address_base ORDER BY uprn',
    );

    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['update'], {
        from: 'user',
      });
    });

    const legacyAddresses = await runQuery(
      'SELECT * FROM address_base_legacy ORDER BY uprn',
    );
    expect(legacyAddresses).toEqual(originalAddresses);
    expect(
      await runQuery("SELECT to_regclass('address_base_tmp') AS table_name"),
    ).toEqual([{ table_name: null }]);
  });

  test('sends a slack message if it updates', async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      STAGE: 'test',
      EPB_TEAM_SLACK_URL: 'http://slack.invalid',
    });
    const slackMessages = [];

    server.use(
      http.post('http://slack.invalid', async ({ request }) => {
        const body = await request.json();
        slackMessages.push(body.text);
        return HttpResponse.json({ ok: true });
      }),
    );

    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install', 'E127 May 2026 Update'], {
        from: 'user',
      });
    });

    expect(slackMessages).toEqual([]);

    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['update'], {
        from: 'user',
      });
    });

    expect(slackMessages).toEqual([
      '[test] 📍 Updated Address Base to version: AddressBase Plus 03.07.2026',
    ]);
  });

  test('errors if no versions are installed', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    const logs = await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['update'], {
        from: 'user',
      });
    });

    expect(logs.trim()).toEqual(dedent`
       No versions are installed to update
    `);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('errors if the version is not found', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install', 'E127 May 2026 Update'], {
        from: 'user',
      });
    });

    const logs = await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['update', 'xxx'], {
        from: 'user',
      });
    });

    expect(logs.trim()).toEqual(dedent`
      Cannot find version xxx
    `);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('returns if already updated to the latest version', async () => {
    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install'], {
        from: 'user',
      });
    });

    const logs = await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['update'], {
        from: 'user',
      });
    });

    expect(logs.trim()).toEqual(dedent`
      No updates to apply
    `);
  });

  test('does not send a slack message if it does not update', async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      STAGE: 'test',
      EPB_TEAM_SLACK_URL: 'http://slack.invalid',
    });
    const slackMessages = [];

    server.use(
      http.post('http://slack.invalid', async ({ request }) => {
        const body = await request.json();
        slackMessages.push(body.text);
        return HttpResponse.json({ ok: true });
      }),
    );

    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install'], {
        from: 'user',
      });
    });

    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['update'], {
        from: 'user',
      });
    });

    expect(slackMessages).toEqual([]);
  });

  test('sends a slack message if it errors', async () => {
    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install'], {
        from: 'user',
      });
    });

    jest.replaceProperty(process, 'env', {
      ...process.env,
      STAGE: 'test',
      EPB_TEAM_SLACK_URL: 'http://slack.invalid',
      OS_DATA_HUB_API_KEY: 'BADKEY',
    });
    const slackMessages = [];

    server.use(
      http.post('http://slack.invalid', async ({ request }) => {
        const body = await request.json();
        slackMessages.push(body.text);
        return HttpResponse.json({ ok: true });
      }),
    );

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['update'], {
        from: 'user',
      });
    });

    expect(slackMessages).toEqual([
      '[test] 🔥 Updating Address Base has errored: status: 403: {"message":"Invalid ApiKey"}',
    ]);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('versions', () => {
  test('lists all available versions', async () => {
    const logs = await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['versions'], { from: 'user' });
    });

    expect(logs.trim()).toEqual(dedent`
      Version                       Installed
      -------                       ---------
      AddressBase Plus 03.07.2026   No
      E128 June 2026 Update         No
      E127 May 2026 Update          No
      E126 April 2026 Update        No
      E125 February 2026 Update     No
      E124 January 2026 Update      No
      E123 November 2025 Update     No
      E122 October 2025 Update      No
      E121 September 2025 Update    No
    `);
  });

  test('marks installed versions', async () => {
    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['install', 'E127 May 2026 Update'], {
        from: 'user',
      });
    });

    await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['update', 'E128 June 2026 Update'], {
        from: 'user',
      });
    });

    const logs = await captureLogs(async () => {
      const program = createProgram();
      await program.parseAsync(['versions'], { from: 'user' });
    });

    expect(logs.trim()).toEqual(dedent`
      Version                       Installed
      -------                       ---------
      AddressBase Plus 03.07.2026   No
      E128 June 2026 Update         Yes
      E127 May 2026 Update          Yes
      E126 April 2026 Update        --
      E125 February 2026 Update     --
      E124 January 2026 Update      --
      E123 November 2025 Update     --
      E122 October 2025 Update      --
      E121 September 2025 Update    --
    `);
  });
});
