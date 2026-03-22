let callbackCounter = 0;

function getUniqueCallbackName(prefix) {
  return `${prefix}_callback_${Date.now()}_${callbackCounter++}`;
}

export function exec(command, options = {}) {
  return new Promise((resolve, reject) => {
    const callbackFuncName = getUniqueCallbackName("exec");

    window[callbackFuncName] = (errno, stdout, stderr) => {
      resolve({ errno, stdout, stderr });
      delete window[callbackFuncName];
    };

    try {
      ksu.exec(command, JSON.stringify(options), callbackFuncName);
    } catch (error) {
      delete window[callbackFuncName];
      reject(error);
    }
  });
}
