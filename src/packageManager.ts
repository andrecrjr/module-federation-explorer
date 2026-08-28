/** @deprecated Import the Node adapter from infrastructure/node instead. */
export {
  detectPackageManagerAndStartCommand,
  type FileExists
} from './infrastructure/node/packageManager';
export type {
  PackageManager,
  PackageManagerConfigType,
  PackageManagerInfo
} from './app/ports';
