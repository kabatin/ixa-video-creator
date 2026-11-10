import { createRealSystem } from '../../real-system.js'

/**
 * real-system.test.ts が別のプロセスで回す（テストのプロセスに本物の SIGINT を送らないため）。
 * 端末につないだ子（`inherit: 'all'`）が動いている間に、自分に SIGINT を送る。
 * 子が自分で終わるまで待ち、子の終了コードを 1 行で出して 0 で終わる。待たずに落ちれば 0 以外になる。
 */
const system = createRealSystem()
setTimeout(() => process.kill(process.pid, 'SIGINT'), 150)
const result = await system.run('sh', ['-c', 'sleep 0.6; exit 7'], { inherit: 'all' })
process.stdout.write(`child:${result.kind === 'completed' ? String(result.exitCode) : result.kind}\n`)
process.stdout.write(`listeners:${String(process.listenerCount('SIGINT'))}\n`)
