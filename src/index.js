// 保证 children 永远是一个数组
function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      // 针对不同的 child 来处理
      children: children.map(child => {
        if (typeof child === 'object') {
          return child
        }
        return createTextElement(child)
      })
    }
  }
}

// 创建文本节点
function createTextElement(text) {
  return {
    type: 'TEXT_ELEMENT',
    props: {
      nodeValue: text,
      children: [],
    }
  }
}

function createDom(fiber) {
  // 针对于文本节点特殊处理，其他的情况直接使用 document.createElement 来进行创建
  const dom = fiber.type === 'TEXT_ELEMENT' ? document.createTextNode('') : document.createElement(fiber.type)

  // 创建 dom，先前的属性，直接传递空
  // 新增当前绑定的一些属性
  updateDom(dom, {}, fiber.props)

  return dom
}

// 属性名以 on 开头的话就是绑定事件
const isEvent = key => key.startsWith("on")
// 是否为属性，除了 children 和 事件 之外的属性
const isProperty = key =>
  key !== "children" && !isEvent(key)
// 是否为新的值，旧值与新值不相等
const isNew = (prev, next) => key =>
  prev[key] !== next[key]
// 是否被删除的属性，key 不在新对象中
const isGone = (prev, next) => key => !(key in next)

function updateDom(dom, prevProps, nextProps) {
  // 移除旧的或已更改的事件
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(
      key =>
        !(key in nextProps) ||
        isNew(prevProps, nextProps)(key)
    )
    .forEach(name => {
      const eventType = name
        .toLowerCase()
        .substring(2)
      dom.removeEventListener(
        eventType,
        prevProps[name]
      )
    })

  // 移除旧的属性
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach(name => {
      dom[name] = ""
    })

  // 设置 新的/已更改 的属性
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      dom[name] = nextProps[name]
    })

  // 新增事件
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      const eventType = name
        .toLowerCase()
        .substring(2)
      dom.addEventListener(
        eventType,
        nextProps[name]
      )
    })
}

function commitRoot() {
  // 将删除的 fiber 也进行统一处理
  deletions.forEach(commitWork)
  // wipRoot.child 存放了第一个子节点，其他子节点通过 sibling 去链接
  commitWork(wipRoot.child)
  // 将当前 root 设置为 上一次的 root
  currentRoot = wipRoot
  // 先前的 root 释放
  wipRoot = null
}
function commitWork(fiber) {
  if (!fiber) {
    return
  }

  let domParentFiber = fiber.parent
  // 这里的父 fiber 一定要保证 dom 存在，不存在的话需要一直向上找，找到具有 dom 的 fiber 节点
  // 函数式组件也算是一个 fiber 节点，但是它没有真实的 dom，所以不能被渲染出来，这里需要一直向上找到存在 dom 的真实 fiber 节点
  while(!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent
  }
  const domParent = domParentFiber.dom

  // 处理替换的 fiber
  if (
    fiber.effectTag === 'PLACEMENT' &&
    fiber.dom !== null // 当前 fiber 节点的 dom 可能为空，这里需要进行判断
  ) {
    // 处理新增
    domParent.appendChild(fiber.dom)
  } else if(fiber.effectTag === 'UPDATE' && fiber.dom !== null) {
    // 处理替换
    updateDom(
      fiber.dom,
      fiber.alternate.props,
      fiber.props
    )
  } else if(fiber.effectTag === 'DELETION') {
    // 处理删除
    commitDeletion(fiber, domParent)
  } 

  // 递归处理当前 fiber 的 child 和兄弟节点
  commitWork(fiber.child)
  commitWork(fiber.sibling)
}

function commitDeletion(fiber, domParent) {
  // 当前 fiber 存在 dom 的情况下，直接进行处理
  if (fiber.dom) {
    domParent.removeChild(fiber.dom)
  } else {
    // 这里也是针对于函数式组件，需要一直向下找到具有真实 dom 的 fiber 节点
    commitDeletion(fiber.child, domParent)
  }
}

function render(element, container) {
  // fiber 根节点（这个就是 workInProgressTree）
  wipRoot = {
    // dom 直接设置 container，相当于生成真实 DOM
    dom: container,
    props: {
      children: [element],
    },
    // 保存当前构建好的 fiber 节点，也就是旧节点
    // React 中会同时存在 2 棵 fiber 树，一棵是 currentFiberTree，另外一棵是 workInProgressTree
    // 当前正在构建的树是 workInProgressTree，currentRoot 将会作为对比，查看是否可以被复用
    alternate: currentRoot,
  }
  // 删除节点
  deletions = []
  // 下一个处理的单元设置为 workInProgressTree 的根节点（nextUnitOfWork 将会在下次浏览器空闲的时候被处理）
  nextUnitOfWork = wipRoot
}

/**
 * 下一个待处理的单元
 */
let nextUnitOfWork = null
/**
 * currentFiberTree 的根节点
 * 在第一次渲染的时候，currentRoot 为空
 */
let currentRoot = null
/**
 * work in progress root
 * workInProgressTree 的根节点
 */
let wipRoot = null
/**
 * 要删除的 fiber 节点
 */
let deletions = null


// deadline 上有 didTimeout 属性（是否超时后的处理） 和 timeRemaining 方法（剩余超时时间）
function workLoop(deadLine) {
  // 是否应该暂停（浏览器是否还有空闲时间让你处理你的业务）
  let shouldYield = false
  while(nextUnitOfWork && !shouldYield) {
    // 获取下一个处理单元（当发现没有值返回的时候，就代表所有节点都被处理完了）
    nextUnitOfWork = performUnitOfWork(
      nextUnitOfWork
    )
    // requestIdleCallback 还提供了一个截止时间参数。我们可以用它来检查在浏览器再次控制之前我们还有多少时间。还有剩余时间的时候，我们可以一直处理自己的任务
    shouldYield = deadLine.timeRemaining() < 1
  }

  // 完成了所有工作，就将整个 fiber 树提交给 dom
  if (!nextUnitOfWork && wipRoot) {
    commitRoot()
  }

  // 等待下次浏览器空闲时机
  requestIdleCallback(workLoop)
}
// 在浏览器空闲时执行 workLoop
requestIdleCallback(workLoop)

// 执行工作单元
function performUnitOfWork(fiber) {
  // 这里直接使用 type 是否为一个 函数来判断是否为函数式组件
  const isFunctionComponent = fiber.type instanceof Function
  if (isFunctionComponent) {
    // 处理函数式组件
    updateFunctionComponent(fiber)
  } else {
    // 处理一般的组件
    updateHostComponent(fiber)
  }

  // 当前 fiber 的 child 存在的话，直接作为下一个处理单元
  // 1、先尝试子节点
  if (fiber.child) {
    return fiber.child
  }

  let nextFiber = fiber
  while(nextFiber) {
    // 2、尝试兄弟节点
    if (nextFiber.sibling) {
      return nextFiber.sibling
    }
    // 3、尝试叔叔节点（然后再进行重复查找）
    nextFiber = nextFiber.parent
  }
}

let wipFiber = null
let hookIndex = null
// 处理函数式组件
function updateFunctionComponent(fiber) {
  // 将 wipFiber 设置为当前操作的 Fiber 节点
  wipFiber = fiber
  // 重置当前的 HookIndex（与 hook 的使用有关系）
  hookIndex = 0
  // 使用一个数组保存当前函数组件的 hook 的执行结果
  wipFiber.hooks = []
  // 函数式组件的 children 需要执行 type 属性
  // 获取里面的 children
  const children = [fiber.type(fiber.props)]
  reconcileChildren(fiber, children)
}

function useState(initial) {
  // 获取先前的快照
  const oldHook = wipFiber?.alternate?.hooks?.[hookIndex]
  // 创造新的快照
  const hook = {
    // 查看是否使用旧值或者是 state 值
    state: oldHook ? oldHook.state : initial,
    queue: [] // 保存设置的队列
  }

  const setState = action => {
    hook.queue.push(action)
    // 重新定义 wipRoot，也是从根组件开始进行渲染
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot
    }
    // 将下一个处理的单元设置为 wipRoot
    nextUnitOfWork = wipRoot
    deletions = []
  }

  // 获取堆积的 actions（下一次节点更新后会执行到这）
  const actions = oldHook ? oldHook.queue : []
  // 批量处理
  actions.forEach(action => {
    // 执行的时候会把每次最新的 state 给传递进去
    hook.state = action(hook.state)
  })

  // 固定的位置的 hooks 再次推入新的 hook（在执行到这里的时候，函数式组件是已经被更新了的）
  wipFiber.hooks.push(hook)
  // 索引增加
  hookIndex++
  return [hook.state, setState]
}

function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber)
  }
  reconcileChildren(fiber, fiber.props.children)
}

/**
 * 针对 wipFiber 新建 子fiber（包括新增和更新），建立好 parent 和 sibling 的关系（beginWork 中会调用 reconcileChildren）
 * 
 * 当前 fiber 节点与子元素 fiber 节点建立连接
 * 给 fiber 节点增加 effectTag 标记，实际上打完标记后还会装载上 effectList
 * @param {*} wipFiber 
 * @param {*} elements fiber 的 children
 */
function reconcileChildren(wipFiber, elements) {
  let index = 0
  // 获取旧的 fiber 的 child，child 只会保存第一个子节点
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child

  let prevSibling = null
  
  // 新旧 fiber 的 child 进行对比
  // 新 fiber 的 child 未遍历完毕 或者 旧 fiber 的 child 未遍历完毕 循环都不停止
  while(
    index < elements.length ||
    oldFiber != null
  ) {
    // 获取当前的子节点
    const element = elements[index]
    let newFiber = null

    // 这里直接判断它们的 type 是否相同来判断 fiber 节点是否可以复用
    const sameType = oldFiber && element && element.type === oldFiber.type

    // fiber 相同进行复用
    if (sameType) {
      newFiber = {
        type: oldFiber.type,
        props: element.props, // 这里依然是拿 element.props 来设置属性
        dom: oldFiber.dom, // dom 复用
        parent: wipFiber,
        alternate: oldFiber, // 保存旧的 fiber 值
        effectTag: 'UPDATE'
      }
    }

    // 新建 fiber
    if (element && !sameType) {
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber, // 与 parent 建立连接
        alternate: null,
        effectTag: 'PLACEMENT'
      }
    }

    // oldFiber 存在，但是 element 不存在了，则说明被删除掉了
    if (oldFiber && !sameType) {
      oldFiber.effectTag = 'DELETION'
      // 把删除的节点记录在 deletions 中
      deletions.push(oldFiber)
    }

    // oldFiber 更换为下一个兄弟节点，和当前的顺序一致。先是 child ，后是 sibling
    if (oldFiber) {
      oldFiber = oldFiber.sibling
    }

    // 父元素只会收集第1个子元素，有多个子元素的情况下，通过子元素的 sibling 来进行链接
    if (index === 0) {
      // 父节点与当前子节点的 fiber 建立连接
      wipFiber.child = newFiber
    } else if (element) {
      // 上一个 fiber 节点维护当前兄弟 fiber 节点，
      prevSibling.sibling = newFiber
    }

    // 保存上一个处理的 fiber 节点
    prevSibling = newFiber
    index++
  }
}

const Didact = {
  createElement,
  render,
  useState,
}

/** @jsx Didact.createElement */
function Counter() {
  const [state, setState] = Didact.useState(1);
  return (
    <h1 onClick={() => setState(c => c + 1)} style="user-select: none">
      Count: {state}
    </h1>
  );
}
// 函数组件是不存在真实 dom 的，这里 h1 是它的 child，渲染的时候只会处理 h1 的渲染
// 这个处理出来的虚拟 dom 的 type 是 Function，需要运行才能获取到真实类型
const element = <Counter />;
console.log('element: ', element);
const container = document.getElementById("root");
Didact.render(element, container);