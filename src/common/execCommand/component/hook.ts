import fs from 'fs-extra';
import { logger } from '../../../logger';
import { IActionHook, IInputs } from '../interface';
import execa from 'execa';
import { execAction } from '../../../execDaemon';
import { filter, get, isEmpty, join, includes } from 'lodash';
import { getGlobalArgs } from '../../../libs';
import { loadComponent } from '../../load';
import { throwError } from '../utils';
import chalk from 'chalk';

class Hook {
  private preHooks: IActionHook[] = [];
  private afterHooks: IActionHook[] = [];
  private output: any;

  constructor(hooks: IActionHook[] = [], private inputs: IInputs) {
    for (const hook of hooks) {
      hook.pre ? this.preHooks.push(hook) : this.afterHooks.push(hook);
    }
  }
  async executePreHook() {
    let temp;
    if (this.preHooks.length > 0) {
      logger.info('Start the pre-action');
      for (const hook of this.preHooks) {
        logger.info(`Action: ${hook.value}`);
        temp = await this.commandExecute(hook);
      }
      logger.info('End the pre-action');
    }
    return temp;
  }

  async executeAfterHook({ output }) {
    if (this.afterHooks.length > 0) {
      this.output = output;
      logger.info('Start the after-action');
      for (const hook of this.afterHooks) {
        logger.info(`Action: ${hook.value}`);
        await this.commandExecute(hook);
      }
      logger.info('End the after-action');
    }
  }

  private async commandExecute(configs: IActionHook) {
    if (configs.type === 'run') {
      const execPath = configs.path;
      if (fs.existsSync(execPath) && fs.lstatSync(execPath).isDirectory()) {
        execa.sync(configs.value, { cwd: execPath, stdio: 'inherit', shell: true });
      }
    }

    if (configs.type === 'component') {
      const argv = await execAction('action.js', configs.value);
      const result = await this.execComponent({ argv });
      return {
        type: configs.type,
        data: result,
      };
    }

    if (configs.type === 'plugin') {
      const instance = await loadComponent(configs.value);
      const result = await instance(this.inputs, configs.args);
      return {
        type: configs.type,
        data: result,
      };
    }
  }

  private async execComponent({ argv }) {
    const { _: rawData } = getGlobalArgs(argv.slice(2));
    const [componentName, method] = rawData;
    const argsObj = filter(argv.slice(2), (o) => !includes([componentName, method], o));
    if (isEmpty(method)) return;
    const instance = await loadComponent(componentName);
    if (instance[method]) {
      // 方法存在，执行报错，退出码101
      try {
        const newInputs = {
          ...this.inputs,
          args: join(argsObj, ' '),
          argsObj,
          output: this.output,
        };
        this.output = await instance[method](newInputs);
        return this.output;
      } catch (error) {
        throwError({
          error,
          serviceName: get(this.inputs, 'project.projectName'),
        });
      }
    }
    // 方法不存在，此时系统将会认为是未找到组件方法，系统的exit code为100；
    throw new Error(
      JSON.stringify({
        code: 100,
        message: `The [${method}] command was not found.`,
        tips: `Please check the component ${componentName} has the ${method} method. Serverless Devs documents：${chalk.underline(
          'https://github.com/Serverless-Devs/Serverless-Devs/blob/master/docs/zh/command',
        )}`,
      }),
    );
  }
}

export default Hook;
