import fs from 'node:fs'
import path from 'node:path'
import { parse as parseUrl, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import colors from 'picocolors'
import type { Alias, AliasOptions } from 'types/alias'
import aliasPlugin from '@rollup/plugin-alias'
import { build } from 'esbuild'
import type { RollupOptions } from 'rollup'
import type { Plugin } from './plugin'
import type {
  BuildOptions,
  RenderBuiltAssetUrl,
  ResolvedBuildOptions
} from './build'
import { resolveBuildOptions } from './build'
import type { ResolvedServerOptions, ServerOptions } from './server'
import { resolveServerOptions } from './server'
import type { PreviewOptions, ResolvedPreviewOptions } from './preview'
import { resolvePreviewOptions } from './preview'
import type { CSSOptions } from './plugins/css'
import {
  asyncFlatten,
  createDebugger,
  createFilter,
  dynamicImport,
  isExternalUrl,
  isObject,
  lookupFile,
  mergeAlias,
  mergeConfig,
  normalizeAlias,
  normalizePath
} from './utils'
import { resolvePlugins } from './plugins'
import type { ESBuildOptions } from './plugins/esbuild'
import {
  CLIENT_ENTRY,
  DEFAULT_ASSETS_RE,
  DEFAULT_CONFIG_FILES,
  ENV_ENTRY
} from './constants'
import type { InternalResolveOptions, ResolveOptions } from './plugins/resolve'
import { resolvePlugin } from './plugins/resolve'
import type { LogLevel, Logger } from './logger'
import { createLogger } from './logger'
import type { DepOptimizationConfig, DepOptimizationOptions } from './optimizer'
import type { JsonOptions } from './plugins/json'
import type { PluginContainer } from './server/pluginContainer'
import { createPluginContainer } from './server/pluginContainer'
import type { PackageCache } from './packages'
import { loadEnv, resolveEnvPrefix } from './env'
import type { ResolvedSSROptions, SSROptions } from './ssr'
import { resolveSSROptions } from './ssr'

const debug = createDebugger('vite:config')

export type { RenderBuiltAssetUrl } from './build'

// NOTE: every export in this file is re-exported from ./index.ts so it will
// be part of the public API.

export interface ConfigEnv {
  command: 'build' | 'serve'
  mode: string
  /**
   * @experimental
   */
  ssrBuild?: boolean
}

/**
 * spa: include SPA fallback middleware and configure sirv with `single: true` in preview
 *
 * mpa: only include non-SPA HTML middlewares
 *
 * custom: don't include HTML middlewares
 */
export type AppType = 'spa' | 'mpa' | 'custom'

export type UserConfigFn = (env: ConfigEnv) => UserConfig | Promise<UserConfig>
export type UserConfigExport = UserConfig | Promise<UserConfig> | UserConfigFn

/**
 * Type helper to make it easier to use vite.config.ts
 * accepts a direct {@link UserConfig} object, or a function that returns it.
 * The function receives a {@link ConfigEnv} object that exposes two properties:
 * `command` (either `'build'` or `'serve'`), and `mode`.
 */
export function defineConfig(config: UserConfigExport): UserConfigExport {
  return config
}

export type PluginOption =
  | Plugin
  | false
  | null
  | undefined
  | PluginOption[]
  | Promise<Plugin | false | null | undefined | PluginOption[]>

export interface UserConfig {
  /**
   * Project root directory. Can be an absolute path, or a path relative from
   * the location of the config file itself.
   * @default process.cwd()
   */
  root?: string
  /**
   * Base public path when served in development or production.
   * @default '/'
   */
  base?: string
  /**
   * Directory to serve as plain static assets. Files in this directory are
   * served and copied to build dist dir as-is without transform. The value
   * can be either an absolute file system path or a path relative to <root>.
   *
   * Set to `false` or an empty string to disable copied static assets to build dist dir.
   * @default 'public'
   */
  publicDir?: string | false
  /**
   * Directory to save cache files. Files in this directory are pre-bundled
   * deps or some other cache files that generated by vite, which can improve
   * the performance. You can use `--force` flag or manually delete the directory
   * to regenerate the cache files. The value can be either an absolute file
   * system path or a path relative to <root>.
   * Default to `.vite` when no `package.json` is detected.
   * @default 'node_modules/.vite'
   */
  cacheDir?: string
  /**
   * Explicitly set a mode to run in. This will override the default mode for
   * each command, and can be overridden by the command line --mode option.
   */
  mode?: string
  /**
   * Define global variable replacements.
   * Entries will be defined on `window` during dev and replaced during build.
   */
  define?: Record<string, any>
  /**
   * Array of vite plugins to use.
   */
  plugins?: PluginOption[]
  /**
   * Configure resolver
   */
  resolve?: ResolveOptions & { alias?: AliasOptions }
  /**
   * CSS related options (preprocessors and CSS modules)
   */
  css?: CSSOptions
  /**
   * JSON loading options
   */
  json?: JsonOptions
  /**
   * Transform options to pass to esbuild.
   * Or set to `false` to disable esbuild.
   */
  esbuild?: ESBuildOptions | false
  /**
   * Specify additional picomatch patterns to be treated as static assets.
   */
  assetsInclude?: string | RegExp | (string | RegExp)[]
  /**
   * Server specific options, e.g. host, port, https...
   */
  server?: ServerOptions
  /**
   * Build specific options
   */
  build?: BuildOptions
  /**
   * Preview specific options, e.g. host, port, https...
   */
  preview?: PreviewOptions
  /**
   * Dep optimization options
   */
  optimizeDeps?: DepOptimizationOptions
  /**
   * SSR specific options
   */
  ssr?: SSROptions
  /**
   * Experimental features
   *
   * Features under this field could change in the future and might NOT follow semver.
   * Please be careful and always pin Vite's version when using them.
   * @experimental
   */
  experimental?: ExperimentalOptions
  /**
   * Legacy options
   *
   * Features under this field only follow semver for patches, they could be removed in a
   * future minor version. Please always pin Vite's version to a minor when using them.
   */
  legacy?: LegacyOptions
  /**
   * Log level.
   * Default: 'info'
   */
  logLevel?: LogLevel
  /**
   * Custom logger.
   */
  customLogger?: Logger
  /**
   * Default: true
   */
  clearScreen?: boolean
  /**
   * Environment files directory. Can be an absolute path, or a path relative from
   * the location of the config file itself.
   * @default root
   */
  envDir?: string
  /**
   * Env variables starts with `envPrefix` will be exposed to your client source code via import.meta.env.
   * @default 'VITE_'
   */
  envPrefix?: string | string[]
  /**
   * Worker bundle options
   */
  worker?: {
    /**
     * Output format for worker bundle
     * @default 'iife'
     */
    format?: 'es' | 'iife'
    /**
     * Vite plugins that apply to worker bundle
     */
    plugins?: PluginOption[]
    /**
     * Rollup options to build worker bundle
     */
    rollupOptions?: Omit<
      RollupOptions,
      'plugins' | 'input' | 'onwarn' | 'preserveEntrySignatures'
    >
  }
  /**
   * Whether your application is a Single Page Application (SPA),
   * a Multi-Page Application (MPA), or Custom Application (SSR
   * and frameworks with custom HTML handling)
   * @default 'spa'
   */
  appType?: AppType
}

export interface ExperimentalOptions {
  /**
   * Append fake `&lang.(ext)` when queries are specified, to preserve the file extension for following plugins to process.
   *
   * @experimental
   * @default false
   */
  importGlobRestoreExtension?: boolean
  /**
   * Allow finegrain control over assets and public files paths
   *
   * @experimental
   */
  renderBuiltUrl?: RenderBuiltAssetUrl
  /**
   * Enables support of HMR partial accept via `import.meta.hot.acceptExports`.
   *
   * @experimental
   * @default false
   */
  hmrPartialAccept?: boolean
}

export interface LegacyOptions {
  /**
   * Revert vite build --ssr to the v2.9 strategy. Use CJS SSR build and v2.9 externalization heuristics
   *
   * @experimental
   * @deprecated
   * @default false
   */
  buildSsrCjsExternalHeuristics?: boolean
}

export interface ResolveWorkerOptions {
  format: 'es' | 'iife'
  plugins: Plugin[]
  rollupOptions: RollupOptions
}

export interface InlineConfig extends UserConfig {
  configFile?: string | false
  envFile?: false
}

export type ResolvedConfig = Readonly<
  Omit<UserConfig, 'plugins' | 'assetsInclude' | 'optimizeDeps' | 'worker'> & {
    configFile: string | undefined
    configFileDependencies: string[]
    inlineConfig: InlineConfig
    root: string
    base: string
    publicDir: string
    cacheDir: string
    command: 'build' | 'serve'
    mode: string
    isWorker: boolean
    // in nested worker bundle to find the main config
    /** @internal */
    mainConfig: ResolvedConfig | null
    isProduction: boolean
    env: Record<string, any>
    resolve: ResolveOptions & {
      alias: Alias[]
    }
    plugins: readonly Plugin[]
    server: ResolvedServerOptions
    build: ResolvedBuildOptions
    preview: ResolvedPreviewOptions
    ssr: ResolvedSSROptions
    assetsInclude: (file: string) => boolean
    logger: Logger
    createResolver: (options?: Partial<InternalResolveOptions>) => ResolveFn
    optimizeDeps: DepOptimizationOptions
    /** @internal */
    packageCache: PackageCache
    worker: ResolveWorkerOptions
    appType: AppType
    experimental: ExperimentalOptions
  }
>

export type ResolveFn = (
  id: string,
  importer?: string,
  aliasOnly?: boolean,
  ssr?: boolean
) => Promise<string | undefined>

export async function resolveConfig(
  inlineConfig: InlineConfig,
  command: 'build' | 'serve',
  defaultMode = 'development'
): Promise<ResolvedConfig> {
  let config = inlineConfig
  let configFileDependencies: string[] = []
  let mode = inlineConfig.mode || defaultMode

  // some dependencies e.g. @vue/compiler-* relies on NODE_ENV for getting
  // production-specific behavior, so set it here even though we haven't
  // resolve the final mode yet
  if (mode === 'production') {
    process.env.NODE_ENV = 'production'
  }
  // production env would not work in serve, fallback to development
  if (command === 'serve' && process.env.NODE_ENV === 'production') {
    process.env.NODE_ENV = 'development'
  }

  const configEnv = {
    mode,
    command,
    ssrBuild: !!config.build?.ssr
  }

  let { configFile } = config
  if (configFile !== false) {
    const loadResult = await loadConfigFromFile(
      configEnv,
      configFile,
      config.root,
      config.logLevel
    )
    if (loadResult) {
      config = mergeConfig(loadResult.config, config)
      configFile = loadResult.path
      configFileDependencies = loadResult.dependencies
    }
  }

  // Define logger
  const logger = createLogger(config.logLevel, {
    allowClearScreen: config.clearScreen,
    customLogger: config.customLogger
  })

  // user config may provide an alternative mode. But --mode has a higher priority
  mode = inlineConfig.mode || config.mode || mode
  configEnv.mode = mode

  // Some plugins that aren't intended to work in the bundling of workers (doing post-processing at build time for example).
  // And Plugins may also have cached that could be corrupted by being used in these extra rollup calls.
  // So we need to separate the worker plugin from the plugin that vite needs to run.
  const rawWorkerUserPlugins = (
    (await asyncFlatten(config.worker?.plugins || [])) as Plugin[]
  ).filter((p) => {
    if (!p) {
      return false
    } else if (!p.apply) {
      return true
    } else if (typeof p.apply === 'function') {
      return p.apply({ ...config, mode }, configEnv)
    } else {
      return p.apply === command
    }
  })

  // resolve plugins
  const rawUserPlugins = (
    (await asyncFlatten(config.plugins || [])) as Plugin[]
  ).filter((p) => {
    if (!p) {
      return false
    } else if (!p.apply) {
      return true
    } else if (typeof p.apply === 'function') {
      return p.apply({ ...config, mode }, configEnv)
    } else {
      return p.apply === command
    }
  })
  const [prePlugins, normalPlugins, postPlugins] =
    sortUserPlugins(rawUserPlugins)

  // run config hooks
  const userPlugins = [...prePlugins, ...normalPlugins, ...postPlugins]
  for (const p of userPlugins) {
    if (p.config) {
      const res = await p.config(config, configEnv)
      if (res) {
        config = mergeConfig(config, res)
      }
    }
  }

  if (process.env.VITE_TEST_WITHOUT_PLUGIN_COMMONJS) {
    config = mergeConfig(config, {
      optimizeDeps: { disabled: false },
      ssr: { optimizeDeps: { disabled: false } }
    })
    config.build ??= {}
    config.build.commonjsOptions = { include: [] }
  }

  // resolve root
  const resolvedRoot = normalizePath(
    config.root ? path.resolve(config.root) : process.cwd()
  )

  const clientAlias = [
    { find: /^[\/]?@vite\/env/, replacement: () => ENV_ENTRY },
    { find: /^[\/]?@vite\/client/, replacement: () => CLIENT_ENTRY }
  ]

  // resolve alias with internal client alias
  const resolvedAlias = normalizeAlias(
    mergeAlias(
      // @ts-ignore because @rollup/plugin-alias' type doesn't allow function
      // replacement, but its implementation does work with function values.
      clientAlias,
      config.resolve?.alias || []
    )
  )

  const resolveOptions: ResolvedConfig['resolve'] = {
    ...config.resolve,
    alias: resolvedAlias
  }

  // load .env files
  const envDir = config.envDir
    ? normalizePath(path.resolve(resolvedRoot, config.envDir))
    : resolvedRoot
  const userEnv =
    inlineConfig.envFile !== false &&
    loadEnv(mode, envDir, resolveEnvPrefix(config))

  // Note it is possible for user to have a custom mode, e.g. `staging` where
  // production-like behavior is expected. This is indicated by NODE_ENV=production
  // loaded from `.staging.env` and set by us as VITE_USER_NODE_ENV
  const isProduction =
    (process.env.NODE_ENV || process.env.VITE_USER_NODE_ENV || mode) ===
    'production'
  if (isProduction) {
    // in case default mode was not production and is overwritten
    process.env.NODE_ENV = 'production'
  }

  // resolve public base url
  const isBuild = command === 'build'
  const relativeBaseShortcut = config.base === '' || config.base === './'

  // During dev, we ignore relative base and fallback to '/'
  // For the SSR build, relative base isn't possible by means
  // of import.meta.url.
  const resolvedBase = relativeBaseShortcut
    ? !isBuild || config.build?.ssr
      ? '/'
      : './'
    : resolveBaseUrl(config.base, isBuild, logger) ?? '/'

  const resolvedBuildOptions = resolveBuildOptions(
    config.build,
    isBuild,
    logger
  )

  // resolve cache directory
  const pkgPath = lookupFile(resolvedRoot, [`package.json`], { pathOnly: true })
  const cacheDir = config.cacheDir
    ? path.resolve(resolvedRoot, config.cacheDir)
    : pkgPath
    ? path.join(path.dirname(pkgPath), `node_modules/.vite`)
    : path.join(resolvedRoot, `.vite`)

  const assetsFilter = config.assetsInclude
    ? createFilter(config.assetsInclude)
    : () => false

  // create an internal resolver to be used in special scenarios, e.g.
  // optimizer & handling css @imports
  const createResolver: ResolvedConfig['createResolver'] = (options) => {
    let aliasContainer: PluginContainer | undefined
    let resolverContainer: PluginContainer | undefined
    return async (id, importer, aliasOnly, ssr) => {
      let container: PluginContainer
      if (aliasOnly) {
        container =
          aliasContainer ||
          (aliasContainer = await createPluginContainer({
            ...resolved,
            plugins: [aliasPlugin({ entries: resolved.resolve.alias })]
          }))
      } else {
        container =
          resolverContainer ||
          (resolverContainer = await createPluginContainer({
            ...resolved,
            plugins: [
              aliasPlugin({ entries: resolved.resolve.alias }),
              resolvePlugin({
                ...resolved.resolve,
                root: resolvedRoot,
                isProduction,
                isBuild: command === 'build',
                ssrConfig: resolved.ssr,
                asSrc: true,
                preferRelative: false,
                tryIndex: true,
                ...options
              })
            ]
          }))
      }
      return (
        await container.resolveId(id, importer, { ssr, scan: options?.scan })
      )?.id
    }
  }

  const { publicDir } = config
  const resolvedPublicDir =
    publicDir !== false && publicDir !== ''
      ? path.resolve(
          resolvedRoot,
          typeof publicDir === 'string' ? publicDir : 'public'
        )
      : ''

  const server = resolveServerOptions(resolvedRoot, config.server, logger)
  const ssr = resolveSSROptions(
    config.ssr,
    config.legacy?.buildSsrCjsExternalHeuristics,
    config.resolve?.preserveSymlinks
  )

  const middlewareMode = config?.server?.middlewareMode

  const optimizeDeps = config.optimizeDeps || {}

  const BASE_URL = resolvedBase

  // resolve worker
  let workerConfig = mergeConfig({}, config)
  const [workerPrePlugins, workerNormalPlugins, workerPostPlugins] =
    sortUserPlugins(rawWorkerUserPlugins)

  // run config hooks
  const workerUserPlugins = [
    ...workerPrePlugins,
    ...workerNormalPlugins,
    ...workerPostPlugins
  ]
  for (const p of workerUserPlugins) {
    if (p.config) {
      const res = await p.config(workerConfig, configEnv)
      if (res) {
        workerConfig = mergeConfig(workerConfig, res)
      }
    }
  }
  const resolvedWorkerOptions: ResolveWorkerOptions = {
    format: workerConfig.worker?.format || 'iife',
    plugins: [],
    rollupOptions: workerConfig.worker?.rollupOptions || {}
  }

  const resolvedConfig: ResolvedConfig = {
    configFile: configFile ? normalizePath(configFile) : undefined,
    configFileDependencies: configFileDependencies.map((name) =>
      normalizePath(path.resolve(name))
    ),
    inlineConfig,
    root: resolvedRoot,
    base: resolvedBase,
    resolve: resolveOptions,
    publicDir: resolvedPublicDir,
    cacheDir,
    command,
    mode,
    ssr,
    isWorker: false,
    mainConfig: null,
    isProduction,
    plugins: userPlugins,
    server,
    build: resolvedBuildOptions,
    preview: resolvePreviewOptions(config.preview, server),
    env: {
      ...userEnv,
      BASE_URL,
      MODE: mode,
      DEV: !isProduction,
      PROD: isProduction
    },
    assetsInclude(file: string) {
      return DEFAULT_ASSETS_RE.test(file) || assetsFilter(file)
    },
    logger,
    packageCache: new Map(),
    createResolver,
    optimizeDeps: {
      disabled: 'build',
      ...optimizeDeps,
      esbuildOptions: {
        preserveSymlinks: config.resolve?.preserveSymlinks,
        ...optimizeDeps.esbuildOptions
      }
    },
    worker: resolvedWorkerOptions,
    appType: config.appType ?? (middlewareMode === 'ssr' ? 'custom' : 'spa'),
    experimental: {
      importGlobRestoreExtension: false,
      hmrPartialAccept: false,
      ...config.experimental
    }
  }
  const resolved: ResolvedConfig = {
    ...config,
    ...resolvedConfig
  }

  ;(resolved.plugins as Plugin[]) = await resolvePlugins(
    resolved,
    prePlugins,
    normalPlugins,
    postPlugins
  )

  const workerResolved: ResolvedConfig = {
    ...workerConfig,
    ...resolvedConfig,
    isWorker: true,
    mainConfig: resolved
  }

  resolvedConfig.worker.plugins = await resolvePlugins(
    workerResolved,
    workerPrePlugins,
    workerNormalPlugins,
    workerPostPlugins
  )

  // call configResolved hooks
  await Promise.all(
    userPlugins
      .map((p) => p.configResolved?.(resolved))
      .concat(
        resolvedConfig.worker.plugins.map((p) =>
          p.configResolved?.(workerResolved)
        )
      )
  )

  // validate config

  if (middlewareMode === 'ssr') {
    logger.warn(
      colors.yellow(
        `Setting server.middlewareMode to 'ssr' is deprecated, set server.middlewareMode to \`true\`${
          config.appType === 'custom' ? '' : ` and appType to 'custom'`
        } instead`
      )
    )
  }
  if (middlewareMode === 'html') {
    logger.warn(
      colors.yellow(
        `Setting server.middlewareMode to 'html' is deprecated, set server.middlewareMode to \`true\` instead`
      )
    )
  }

  if (
    config.server?.force &&
    !isBuild &&
    config.optimizeDeps?.force === undefined
  ) {
    resolved.optimizeDeps.force = true
    logger.warn(
      colors.yellow(
        `server.force is deprecated, use optimizeDeps.force instead`
      )
    )
  }

  if (process.env.DEBUG) {
    debug(`using resolved config: %O`, {
      ...resolved,
      plugins: resolved.plugins.map((p) => p.name),
      worker: {
        ...resolved.worker,
        plugins: resolved.worker.plugins.map((p) => p.name)
      }
    })
  }

  if (config.build?.terserOptions && config.build.minify !== 'terser') {
    logger.warn(
      colors.yellow(
        `build.terserOptions is specified but build.minify is not set to use Terser. ` +
          `Note Vite now defaults to use esbuild for minification. If you still ` +
          `prefer Terser, set build.minify to "terser".`
      )
    )
  }

  // Check if all assetFileNames have the same reference.
  // If not, display a warn for user.
  const outputOption = config.build?.rollupOptions?.output ?? []
  // Use isArray to narrow its type to array
  if (Array.isArray(outputOption)) {
    const assetFileNamesList = outputOption.map(
      (output) => output.assetFileNames
    )
    if (assetFileNamesList.length > 1) {
      const firstAssetFileNames = assetFileNamesList[0]
      const hasDifferentReference = assetFileNamesList.some(
        (assetFileNames) => assetFileNames !== firstAssetFileNames
      )
      if (hasDifferentReference) {
        resolved.logger.warn(
          colors.yellow(`
assetFileNames isn't equal for every build.rollupOptions.output. A single pattern across all outputs is supported by Vite.
`)
        )
      }
    }
  }

  return resolved
}

/**
 * Resolve base url. Note that some users use Vite to build for non-web targets like
 * electron or expects to deploy
 */
export function resolveBaseUrl(
  base: UserConfig['base'] = '/',
  isBuild: boolean,
  logger: Logger
): string {
  if (base.startsWith('.')) {
    logger.warn(
      colors.yellow(
        colors.bold(
          `(!) invalid "base" option: ${base}. The value can only be an absolute ` +
            `URL, ./, or an empty string.`
        )
      )
    )
    base = '/'
  }

  // external URL
  if (isExternalUrl(base)) {
    if (!isBuild) {
      // get base from full url during dev
      const parsed = parseUrl(base)
      base = parsed.pathname || '/'
    }
  } else {
    // ensure leading slash
    if (!base.startsWith('/')) {
      logger.warn(
        colors.yellow(
          colors.bold(`(!) "base" option should start with a slash.`)
        )
      )
      base = '/' + base
    }
  }

  // ensure ending slash
  if (!base.endsWith('/')) {
    logger.warn(
      colors.yellow(colors.bold(`(!) "base" option should end with a slash.`))
    )
    base += '/'
  }

  return base
}

export function sortUserPlugins(
  plugins: (Plugin | Plugin[])[] | undefined
): [Plugin[], Plugin[], Plugin[]] {
  const prePlugins: Plugin[] = []
  const postPlugins: Plugin[] = []
  const normalPlugins: Plugin[] = []

  if (plugins) {
    plugins.flat().forEach((p) => {
      if (p.enforce === 'pre') prePlugins.push(p)
      else if (p.enforce === 'post') postPlugins.push(p)
      else normalPlugins.push(p)
    })
  }

  return [prePlugins, normalPlugins, postPlugins]
}

export async function loadConfigFromFile(
  configEnv: ConfigEnv,
  configFile?: string,
  configRoot: string = process.cwd(),
  logLevel?: LogLevel
): Promise<{
  path: string
  config: UserConfig
  dependencies: string[]
} | null> {
  const start = performance.now()
  const getTime = () => `${(performance.now() - start).toFixed(2)}ms`

  let resolvedPath: string | undefined

  if (configFile) {
    // explicit config path is always resolved from cwd
    resolvedPath = path.resolve(configFile)
  } else {
    // implicit config file loaded from inline root (if present)
    // otherwise from cwd
    for (const filename of DEFAULT_CONFIG_FILES) {
      const filePath = path.resolve(configRoot, filename)
      if (!fs.existsSync(filePath)) continue

      resolvedPath = filePath
      break
    }
  }

  if (!resolvedPath) {
    debug('no config file found.')
    return null
  }

  let isESM = false
  if (/\.m[jt]s$/.test(resolvedPath)) {
    isESM = true
  } else if (/\.c[jt]s$/.test(resolvedPath)) {
    isESM = false
  } else {
    // check package.json for type: "module" and set `isESM` to true
    try {
      const pkg = lookupFile(configRoot, ['package.json'])
      isESM = !!pkg && JSON.parse(pkg).type === 'module'
    } catch (e) {}
  }

  try {
    const bundled = await bundleConfigFile(resolvedPath, isESM)
    const userConfig = await loadConfigFromBundledFile(
      resolvedPath,
      bundled.code,
      isESM
    )
    debug(`bundled config file loaded in ${getTime()}`)

    const config = await (typeof userConfig === 'function'
      ? userConfig(configEnv)
      : userConfig)
    if (!isObject(config)) {
      throw new Error(`config must export or return an object.`)
    }
    return {
      path: normalizePath(resolvedPath),
      config,
      dependencies: bundled.dependencies
    }
  } catch (e) {
    createLogger(logLevel).error(
      colors.red(`failed to load config from ${resolvedPath}`),
      { error: e }
    )
    throw e
  }
}

async function bundleConfigFile(
  fileName: string,
  isESM: boolean
): Promise<{ code: string; dependencies: string[] }> {
  const dirnameVarName = '__vite_injected_original_dirname'
  const filenameVarName = '__vite_injected_original_filename'
  const importMetaUrlVarName = '__vite_injected_original_import_meta_url'
  const result = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [fileName],
    outfile: 'out.js',
    write: false,
    target: ['node14.18', 'node16'],
    platform: 'node',
    bundle: true,
    format: isESM ? 'esm' : 'cjs',
    sourcemap: 'inline',
    metafile: true,
    define: {
      __dirname: dirnameVarName,
      __filename: filenameVarName,
      'import.meta.url': importMetaUrlVarName
    },
    plugins: [
      {
        name: 'externalize-deps',
        setup(build) {
          build.onResolve({ filter: /.*/ }, ({ path: id, importer }) => {
            // externalize bare imports
            if (id[0] !== '.' && !path.isAbsolute(id)) {
              return {
                external: true
              }
            }
            // bundle the rest and make sure that the we can also access
            // it's third-party dependencies. externalize if not.
            // monorepo/
            // ├─ package.json
            // ├─ utils.js -----------> bundle (share same node_modules)
            // ├─ vite-project/
            // │  ├─ vite.config.js --> entry
            // │  ├─ package.json
            // ├─ foo-project/
            // │  ├─ utils.js --------> external (has own node_modules)
            // │  ├─ package.json
            const idFsPath = path.resolve(path.dirname(importer), id)
            const idPkgPath = lookupFile(idFsPath, [`package.json`], {
              pathOnly: true
            })
            if (idPkgPath) {
              const idPkgDir = path.dirname(idPkgPath)
              // if this file needs to go up one or more directory to reach the vite config,
              // that means it has it's own node_modules (e.g. foo-project)
              if (path.relative(idPkgDir, fileName).startsWith('..')) {
                return {
                  // normalize actual import after bundled as a single vite config
                  path: pathToFileURL(idFsPath).href,
                  external: true
                }
              }
            }
          })
        }
      },
      {
        name: 'inject-file-scope-variables',
        setup(build) {
          build.onLoad({ filter: /\.[cm]?[jt]s$/ }, async (args) => {
            const contents = await fs.promises.readFile(args.path, 'utf8')
            const injectValues =
              `const ${dirnameVarName} = ${JSON.stringify(
                path.dirname(args.path)
              )};` +
              `const ${filenameVarName} = ${JSON.stringify(args.path)};` +
              `const ${importMetaUrlVarName} = ${JSON.stringify(
                pathToFileURL(args.path).href
              )};`

            return {
              loader: args.path.endsWith('ts') ? 'ts' : 'js',
              contents: injectValues + contents
            }
          })
        }
      }
    ]
  })
  const { text } = result.outputFiles[0]
  return {
    code: text,
    dependencies: result.metafile ? Object.keys(result.metafile.inputs) : []
  }
}

interface NodeModuleWithCompile extends NodeModule {
  _compile(code: string, filename: string): any
}

const _require = createRequire(import.meta.url)
async function loadConfigFromBundledFile(
  fileName: string,
  bundledCode: string,
  isESM: boolean
): Promise<UserConfigExport> {
  // for esm, before we can register loaders without requiring users to run node
  // with --experimental-loader themselves, we have to do a hack here:
  // write it to disk, load it with native Node ESM, then delete the file.
  if (isESM) {
    const fileBase = `${fileName}.timestamp-${Date.now()}`
    const fileNameTmp = `${fileBase}.mjs`
    const fileUrl = `${pathToFileURL(fileBase)}.mjs`
    fs.writeFileSync(fileNameTmp, bundledCode)
    try {
      return (await dynamicImport(fileUrl)).default
    } finally {
      fs.unlinkSync(fileNameTmp)
    }
  }
  // for cjs, we can register a custom loader via `_require.extensions`
  else {
    const extension = path.extname(fileName)
    const realFileName = fs.realpathSync(fileName)
    const loaderExt = extension in _require.extensions ? extension : '.js'
    const defaultLoader = _require.extensions[loaderExt]!
    _require.extensions[loaderExt] = (module: NodeModule, filename: string) => {
      if (filename === realFileName) {
        ;(module as NodeModuleWithCompile)._compile(bundledCode, filename)
      } else {
        defaultLoader(module, filename)
      }
    }
    // clear cache in case of server restart
    delete _require.cache[_require.resolve(fileName)]
    const raw = _require(fileName)
    _require.extensions[loaderExt] = defaultLoader
    return raw.__esModule ? raw.default : raw
  }
}

export function getDepOptimizationConfig(
  config: ResolvedConfig,
  ssr: boolean
): DepOptimizationConfig {
  return ssr ? config.ssr.optimizeDeps : config.optimizeDeps
}
export function isDepsOptimizerEnabled(
  config: ResolvedConfig,
  ssr: boolean
): boolean {
  const { command } = config
  const { disabled } = getDepOptimizationConfig(config, ssr)
  return !(
    disabled === true ||
    (command === 'build' && disabled === 'build') ||
    (command === 'serve' && disabled === 'dev')
  )
}
