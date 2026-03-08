'use strict';

const { DynamoDbPersistenceAdapter } = require('ask-sdk-dynamodb-persistence-adapter');

function createPersistenceAdapter() {
  return new DynamoDbPersistenceAdapter({
    tableName: process.env.DYNAMODB_PERSISTENCE_TABLE_NAME || 'TrasportoUrbanoBariSkillTable',
    createTable: true
  });
}

module.exports = {
  createPersistenceAdapter
};
