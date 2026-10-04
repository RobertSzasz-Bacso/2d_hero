declare module "rbush" {
  export interface RBushBox {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }

  export default class RBush<T> {
    constructor(maxEntries?: number)
    insert(item: T): this
    load(items: readonly T[]): this
    search(bbox: RBushBox): T[]
    clear(): this
  }
}
