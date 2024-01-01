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
  const domParent = fiber.parent.dom

  // 处理替换的 fiber
  if (
    fiber.effectTag === 'PLACEMENT' &&
    fiber.dom !== null
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
    domParent.removeChild(fiber.dom)
  } 

  // 递归处理当前 fiber 的 child 和兄弟节点
  commitWork(fiber.child)
  commitWork(fiber.sibling)
}

function render(element, container) {
  // fiber 根节点
  wipRoot = {
    // dom 直接设置 container，相当于生成真实 DOM
    dom: container,
    props: {
      children: [element],
    },
    // 保存当前构建好的 fiber 节点，也就是旧节点
    alternate: currentRoot,
  }
  // 删除节点
  deletions = []
  // 下一个处理的单元
  nextUnitOfWork = wipRoot
}

/**
 * 下一个待处理的单元
 */
let nextUnitOfWork = null
let currentRoot = null
/**
 * 当前 fiber 的根节点
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
// // 在浏览器空闲时执行 workLoop
requestIdleCallback(workLoop)

function performUnitOfWork(fiber) {
  // 虚拟 DOM 还没变成真实 DOM 的情况下，创建新的 DOM
  if (!fiber.dom) {
    // 创建一个新的节点并将其添加到 DOM 中
    fiber.dom = createDom(fiber)
  }

  const elements = fiber.props.children
  // 当前 fiber 节点与子元素 fiber 节点建立连接
  reconcileChildren(fiber, elements)

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

// 针对 wipFiber 新建 子fiber，建立好 parent 和 sibling 的关系
// 当前 fiber 节点与子元素 fiber 节点建立连接
function reconcileChildren(wipFiber, elements) {
  let index = 0
  // 获取旧的 fiber 的 child，child 只会保存第一个子节点
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child

  let prevSibling = null
  
  // 新旧 fiber 进行对比
  while(
    index < elements.length ||
    oldFiber != null
  ) {
    const element = elements[index]
    let newFiber = null
    const sameType = oldFiber && element && element.type === oldFiber.type

    // fiber 相同进行复用
    if (sameType) {
      newFiber = {
        type: oldFiber.type,
        props: element.props, // 这里依然是拿 element.props 来设置属性
        dom: oldFiber.dom,
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

    // 给 oldFiber 打标志
    if (oldFiber && !sameType) {
      oldFiber.effectTag = 'DELETION'
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
}

/** @jsx Didact.createElement  */
const container = document.getElementById("root")

const updateValue = e => {
  console.log(2233344);
  rerender(e.target.value)
}

const rerender = value => {
  // 经过 React 解析，会变成一个对象
  const element = (
    <div>
      <input onInput={updateValue} value={value} />
      <h2>Hello {value}</h2>
    </div>
  )
  Didact.render(element, container)
}

rerender("World")