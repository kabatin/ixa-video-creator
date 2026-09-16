import IORedis, { type Redis } from 'ioredis'

/**
 * BullMQ 用の ioredis 接続を作る。
 * BullMQ が要求する maxRetriesPerRequest: null を設定する。
 * https://docs.bullmq.io/guide/going-to-production#maxretriesperrequest
 */
export const createRedisConnection = (redisUrl: string): Redis =>
  new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  })
