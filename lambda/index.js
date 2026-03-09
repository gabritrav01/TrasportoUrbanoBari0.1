'use strict';

const { createSkillHandler } = require('./config/bootstrap');

const skillHandler = createSkillHandler();

exports.handler = async (event, context) => {
  return skillHandler(event, context);
};
