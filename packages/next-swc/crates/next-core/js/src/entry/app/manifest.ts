import type {
  ClientCSSReferenceManifest,
  ClientReferenceManifest,
} from 'next/dist/build/webpack/plugins/flight-manifest-plugin'

export function createManifests() {
  const proxyMethodsForModule = (
    id: string
  ): ProxyHandler<ClientReferenceManifest['ssrModuleMapping']> => {
    return {
      get(_target, prop: string) {
        return {
          id,
          chunks: JSON.parse(id)[1],
          name: prop,
        }
      },
    }
  }

  const proxyMethodsNested = (
    type: 'ssrModuleMapping' | 'clientModules'
  ): ProxyHandler<
    | ClientReferenceManifest['ssrModuleMapping']
    | ClientReferenceManifest['clientModules']
  > => {
    return {
      get(_target, key: string) {
        if (type === 'ssrModuleMapping') {
          return new Proxy({}, proxyMethodsForModule(key as string))
        }
        if (type === 'clientModules') {
          // The key is a `${file}#${name}`, but `file` can contain `#` itself.
          // There are 2 possibilities:
          //   "file#"    => id = "file", name = ""
          //   "file#foo" => id = "file", name = "foo"
          const pos = key.lastIndexOf('#')
          let id = key
          let name = ''
          if (pos !== -1) {
            id = key.slice(0, pos)
            name = key.slice(pos + 1)
          } else {
            throw new Error('keys need to be formatted as {file}#{name}')
          }

          return {
            id,
            name,
            chunks: JSON.parse(id)[1],
          }
        }
      },
    }
  }

  const availableModules = new Set()
  const toPath = (chunk: ChunkData) =>
    typeof chunk === 'string' ? chunk : chunk.path
  /// determines if a chunk is needed based on the current available modules
  const filterAvailable = (chunk: ChunkData) => {
    if (typeof chunk === 'string') {
      return true
    } else {
      let includedList = chunk.included || []
      if (includedList.length === 0) {
        return true
      }
      let needed = false
      for (const item of includedList) {
        if (!availableModules.has(item)) {
          availableModules.add(item)
          needed = true
        }
      }
      return needed
    }
  }
  const proxyMethods = (): ProxyHandler<ClientReferenceManifest> => {
    const clientModulesProxy = new Proxy(
      {},
      proxyMethodsNested('clientModules')
    )
    const ssrModuleMappingProxy = new Proxy(
      {},
      proxyMethodsNested('ssrModuleMapping')
    )
    return {
      get(_target: any, prop: string) {
        if (prop === 'ssrModuleMapping') {
          return ssrModuleMappingProxy
        }
        if (prop === 'clientModules') {
          return clientModulesProxy
        }
      },
    }
  }

  const cssImportProxyMethods = {
    get(_target: any, prop: string) {
      let cssChunks;
      try {
      cssChunks = JSON.parse(prop.replace(/\.js$/, ''))
      } catch (e) {
        throw new Error(`Unexpected property (${prop}) accessed from proxy manifest`);
      }
      // TODO(WEB-856) subscribe to changes

      // This return value is passed to proxyMethodsNested for clientModules
      return cssChunks
        .filter(filterAvailable)
        .map(toPath)
        .map((chunk: string) => JSON.stringify([chunk, [chunk]]))
    },
  }
  const clientReferenceManifest: ClientReferenceManifest = new Proxy(
    {} as any,
    proxyMethods()
  )

  const serverCSSManifest: ClientCSSReferenceManifest = {
    cssImports: new Proxy({} as any, cssImportProxyMethods),
    cssModules: {},
  }

  return { clientReferenceManifest, serverCSSManifest }
}

export function installRequireAndChunkLoad() {
  globalThis.__next_require__ = (data) => {
    const [, , ssr_id] = JSON.parse(data)
    return __turbopack_require__(ssr_id)
  }
  globalThis.__next_chunk_load__ = () => Promise.resolve()
}
