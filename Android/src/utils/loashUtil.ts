/**
 * @file
 * 魔改 loash
 */

/**
 * 防抖配置
 */
export interface DebounceOptions {
  /**
   * 指定是否在超时的前沿调用
   */
  leading?: boolean | undefined;
  /**
   * 调用 func 之前允许延迟的最长时间
   */
  maxWait?: number | undefined;
  /**
   * 指定是否在超时后沿调用
   */
  trailing?: boolean | undefined;
}
export interface DebouncedFunc<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): ReturnType<T> | undefined;

  /**
   * 丢弃任何挂起的 debounced 函数调用
   */
  cancel(): void;

  /**
   * 如果有一个挂起的 debounced 函数调用，立即调用它并返回其返回值
   * 否则，返回上一次调用的值，或者如果函数从未被调用过，则返回 undefined
   */
  flush(): ReturnType<T> | undefined;
}

/**
 * 节流配置
 */
export interface ThrottleOptions {
  /**
   * 指定在超时的前沿调用
   */
  leading?: boolean | undefined;
  /**
   * 指定在超时后沿调用
   */
  trailing?: boolean | undefined;
}

const objectProto = Object.prototype;

const hasOwnProperty = objectProto.hasOwnProperty;

const nativeObjectToString = objectProto.toString;

const undefinedTag = '[object Undefined]';

const nullTag = '[object Null]';

const symbolTag = '[object Symbol]';

const symToStringTag = Symbol.toStringTag;

const NAN = 0 / 0;

const reWhitespace = /\s/;

const reTrimStart = /^\s+/;

const reIsBinary = /^0b[01]+$/i;

const reIsOctal = /^0o[0-7]+$/i;

const reIsBadHex = /^[-+]0x[0-9a-f]+$/i;

const freeParseInt = parseInt;

/**
 * baseGetTag 的一个专门版本，它忽略了 Symbol.toStringTag 值
 * @param value
 * @returns
 */
function getRawTag(value: any) {
  const isOwn = hasOwnProperty.call(value, symToStringTag),
    tag = value[symToStringTag];
  let unmasked = false;
  try {
    value[symToStringTag] = undefined;
    unmasked = true;
  } catch (e) {}

  const result = nativeObjectToString.call(value);
  if (unmasked) {
    if (isOwn) {
      value[symToStringTag] = tag;
    } else {
      delete value[symToStringTag];
    }
  }
  return result;
}

/**
 * Object.prototype.toString
 * @param value
 * @returns
 */
function objectToString(value: any) {
  return nativeObjectToString.call(value);
}

/**
 * 针对有缺陷的环境下，getTag 基本实现
 * @param value
 * @returns
 */
function baseGetTag(value: any) {
  if (value == null) {
    return value === undefined ? undefinedTag : nullTag;
  }
  return symToStringTag && symToStringTag in Object(value) ? getRawTag(value) : objectToString(value);
}

/**
 * 检查 value 是否类似对象
 * @param value
 * @returns
 */
function isObjectLike(value: any) {
  return value != null && typeof value == 'object';
}

/**
 * 检查 value 是否对象
 * @param value
 * @returns
 */
function isObject(value?: any): value is Object {
  const type = typeof value;
  return value != null && (type == 'object' || type == 'function');
}

/**
 * 检查 value 是否 Symbol
 * @param value
 * @returns
 */
function isSymbol(value: any) {
  return typeof value == 'symbol' || (isObjectLike(value) && baseGetTag(value) == symbolTag);
}

/**
 * 获取 string 的最后一个非空字符索引
 * @param string
 * @returns
 */
function trimmedEndIndex(string: string) {
  var index = string.length;

  while (index-- && reWhitespace.test(string.charAt(index))) {}
  return index;
}

/**
 * trim 的基础实现
 * @param string
 * @returns
 */
function baseTrim(string: string) {
  return string ? string.slice(0, trimmedEndIndex(string) + 1).replace(reTrimStart, '') : string;
}

/**
 * 将 value 转换为 number
 * @param value
 * @returns
 */
export function toNumber(value: any): number {
  if (typeof value == 'number') {
    return value;
  }
  if (isSymbol(value)) {
    return NAN;
  }
  if (isObject(value)) {
    const other = typeof value.valueOf == 'function' ? value.valueOf() : value;
    value = isObject(other) ? other + '' : other;
  }
  if (typeof value != 'string') {
    return value === 0 ? value : +value;
  }
  value = baseTrim(value);
  const isBinary = reIsBinary.test(value);
  return isBinary || reIsOctal.test(value)
    ? freeParseInt(value.slice(2), isBinary ? 2 : 8)
    : reIsBadHex.test(value)
    ? NAN
    : +value;
}

/**
 * 创建一个防抖函数
 * @param func 将要防抖的源函数
 * @param wait 延迟的毫秒数
 * @param options 配置对象
 * @returns 返回防抖函数
 */
export function debounce<T extends (...args: any) => any>(
  func: T,
  wait?: number,
  options?: DebounceOptions
): DebouncedFunc<T> {
  let lastArgs: any,
    lastThis: any,
    maxWait: number = 0,
    result: DebouncedFunc<T>,
    timerId: ReturnType<typeof setTimeout> | undefined,
    lastCallTime: number | undefined,
    lastInvokeTime = 0,
    leading = false,
    maxing = false,
    trailing = true;

  if (typeof func != 'function') {
    throw new TypeError('Expected a function');
  }
  wait = toNumber(wait) || 0;
  if (isObject(options)) {
    leading = !!options.leading;
    maxing = 'maxWait' in options;
    maxWait = maxing ? Math.max(toNumber(options.maxWait) || 0, wait) : maxWait;
    trailing = 'trailing' in options ? !!options.trailing : trailing;
  }

  function invokeFunc(time: number) {
    const args = lastArgs,
      thisArg = lastThis;

    lastArgs = lastThis = undefined;
    lastInvokeTime = time;
    result = func.apply(thisArg, args);
    return result;
  }

  function leadingEdge(time: number) {
    lastInvokeTime = time;
    timerId = setTimeout(timerExpired, wait);
    return leading ? invokeFunc(time) : result;
  }

  function remainingWait(time: number) {
    const timeSinceLastCall = time - (lastCallTime as number),
      timeSinceLastInvoke = time - lastInvokeTime,
      timeWaiting = (wait as number) - timeSinceLastCall;

    return maxing ? Math.min(timeWaiting, maxWait - timeSinceLastInvoke) : timeWaiting;
  }

  function shouldInvoke(time: number) {
    const timeSinceLastCall = time - (lastCallTime as number),
      timeSinceLastInvoke = time - lastInvokeTime;

    return (
      lastCallTime === undefined ||
      timeSinceLastCall >= (wait as number) ||
      timeSinceLastCall < 0 ||
      (maxing && timeSinceLastInvoke >= maxWait)
    );
  }

  function timerExpired() {
    const time = Date.now();
    if (shouldInvoke(time)) {
      return trailingEdge(time);
    }
    timerId = setTimeout(timerExpired, remainingWait(time));
  }

  function trailingEdge(time: number) {
    timerId = undefined;

    if (trailing && lastArgs) {
      return invokeFunc(time);
    }
    lastArgs = lastThis = undefined;
    return result;
  }

  function cancel() {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
    lastInvokeTime = 0;
    lastArgs = lastCallTime = lastThis = timerId = undefined;
  }

  function flush() {
    return timerId === undefined ? result : trailingEdge(Date.now());
  }

  function debounced(this: any) {
    const time = Date.now(),
      isInvoking = shouldInvoke(time);

    lastArgs = arguments;
    lastThis = this;
    lastCallTime = time;

    if (isInvoking) {
      if (timerId === undefined) {
        return leadingEdge(lastCallTime);
      }
      if (maxing) {
        clearTimeout(timerId);
        timerId = setTimeout(timerExpired, wait);
        return invokeFunc(lastCallTime);
      }
    }
    if (timerId === undefined) {
      timerId = setTimeout(timerExpired, wait);
    }
    return result;
  }
  debounced.cancel = cancel;
  debounced.flush = flush;
  return debounced as DebouncedFunc<T>;
}

/**
 * 创建一个节流函数
 * @param func 将要节流的原函数
 * @param wait 节流毫秒数
 * @param options 配置对象
 * @returns 返回一个节流函数
 */
export function throttle<T extends (...args: any) => any>(func: T, wait?: number, options?: ThrottleOptions) {
  let leading = true,
    trailing = true;

  if (typeof func != 'function') {
    throw new TypeError('Expected a function');
  }
  if (isObject(options)) {
    leading = 'leading' in options ? !!options.leading : leading;
    trailing = 'trailing' in options ? !!options.trailing : trailing;
  }
  return debounce(func, wait, {
    leading: leading,
    maxWait: wait,
    trailing: trailing
  });
}
