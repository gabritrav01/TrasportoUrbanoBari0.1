'use strict';

const { DynamoDbPersistenceAdapter } = require('ask-sdk-dynamodb-persistence-adapter');

const DEFAULT_TABLE_NAME = 'TrasportoUrbanoBariSkillTable';

function parseBooleanEnv(value, fallbackValue) {
  if (value === null || value === undefined || value === '') {
    return Boolean(fallbackValue);
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return Boolean(fallbackValue);
}

function hasAwsCredentialHints(env) {
  return Boolean(
    (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) ||
      env.AWS_SESSION_TOKEN ||
      env.AWS_WEB_IDENTITY_TOKEN_FILE ||
      env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
      env.AWS_CONTAINER_CREDENTIALS_FULL_URI
  );
}

function resolveIdentityKey(requestEnvelope) {
  const envelope = requestEnvelope || {};
  const context = envelope.context || {};
  const system = context.System || {};
  const user = system.user || {};
  const device = system.device || {};
  const application = system.application || {};

  return (
    user.userId ||
    device.deviceId ||
    application.applicationId ||
    'anonymous-user'
  );
}

function createMemoryPersistenceAdapter() {
  const store = new Map();

  return {
    async getAttributes(requestEnvelope) {
      const key = resolveIdentityKey(requestEnvelope);
      return store.get(key) || {};
    },

    async saveAttributes(requestEnvelope, attributes) {
      const key = resolveIdentityKey(requestEnvelope);
      store.set(key, attributes && typeof attributes === 'object' ? attributes : {});
    },

    async deleteAttributes(requestEnvelope) {
      const key = resolveIdentityKey(requestEnvelope);
      store.delete(key);
    }
  };
}

function createSafePersistenceAdapter({ primaryAdapter, fallbackAdapter, logger }) {
  let activeAdapter = primaryAdapter;
  let fallbackActivated = false;

  function activateFallback(reason, error) {
    if (!fallbackActivated) {
      fallbackActivated = true;
      logger.warn('[PERSISTENCE_DISABLED_FALLBACK]', {
        reason,
        code: error && error.code ? error.code : 'UNKNOWN',
        message: error && error.message ? error.message : String(error)
      });
    }
    activeAdapter = fallbackAdapter;
  }

  async function safeCall(methodName, args, fallbackValue) {
    const method = activeAdapter && activeAdapter[methodName];
    if (typeof method !== 'function') {
      activateFallback(`missing_method_${methodName}`);
      return fallbackValue;
    }

    try {
      return await method(...args);
    } catch (error) {
      activateFallback(`${methodName}_failed`, error);
      const fallbackMethod = fallbackAdapter && fallbackAdapter[methodName];
      if (typeof fallbackMethod === 'function') {
        return fallbackMethod(...args);
      }
      return fallbackValue;
    }
  }

  return {
    getAttributes(requestEnvelope) {
      return safeCall('getAttributes', [requestEnvelope], {});
    },

    saveAttributes(requestEnvelope, attributes) {
      return safeCall('saveAttributes', [requestEnvelope, attributes], undefined);
    },

    deleteAttributes(requestEnvelope) {
      return safeCall('deleteAttributes', [requestEnvelope], undefined);
    }
  };
}

function createPersistenceAdapter(options = {}) {
  const env = options.env || process.env;
  const logger = options.logger || console;
  const enabled = parseBooleanEnv(env.PERSISTENCE_ENABLED, true);
  const createTableRequested = parseBooleanEnv(env.PERSISTENCE_CREATE_TABLE, false);
  const canCreateTableSafely = hasAwsCredentialHints(env);
  const createTable = createTableRequested && canCreateTableSafely;
  const tableName = env.DYNAMODB_PERSISTENCE_TABLE_NAME || DEFAULT_TABLE_NAME;
  const memoryAdapter = createMemoryPersistenceAdapter();

  if (createTableRequested && !createTable) {
    logger.warn('[PERSISTENCE_DISABLED_FALLBACK]', {
      reason: 'create_table_requested_without_aws_credential_hints'
    });
  }

  logger.info('[PERSISTENCE_ENABLED]', {
    enabled,
    createTableRequested,
    createTable,
    tableName
  });

  if (!enabled) {
    logger.warn('[PERSISTENCE_DISABLED_FALLBACK]', {
      reason: 'PERSISTENCE_ENABLED=false'
    });
    return {
      adapter: memoryAdapter,
      meta: {
        enabled: false,
        mode: 'memory',
        createTableRequested,
        createTable,
        tableName
      }
    };
  }

  try {
    const dynamoAdapter = new DynamoDbPersistenceAdapter({
      tableName,
      createTable
    });

    return {
      adapter: createSafePersistenceAdapter({
        primaryAdapter: dynamoAdapter,
        fallbackAdapter: memoryAdapter,
        logger
      }),
      meta: {
        enabled: true,
        mode: 'dynamodb',
        createTableRequested,
        createTable,
        tableName
      }
    };
  } catch (error) {
    logger.error('[PERSISTENCE_DISABLED_FALLBACK]', {
      reason: 'adapter_init_failed',
      code: error && error.code ? error.code : 'UNKNOWN',
      message: error && error.message ? error.message : String(error)
    });
    return {
      adapter: memoryAdapter,
      meta: {
        enabled: false,
        mode: 'memory',
        createTableRequested,
        createTable,
        tableName,
        reason: 'adapter_init_failed'
      }
    };
  }
}

module.exports = {
  createPersistenceAdapter
};
