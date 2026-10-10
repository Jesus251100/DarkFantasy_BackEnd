import type { Booster } from './Booster'
import { BoosterFreeze } from './BoosterFreeze'
import { BoosterGoodLuck } from './BoosterGoodLuck'
import { BoosterSabotage } from './BoosterSabotage'
import { BoosterShield } from './BoosterShield'

/** Lista los boosters. Un ítem nuevo = clase nueva + una línea aquí (O). */
export class CatalogoBoosters {
  private static readonly todos: Booster[] = [
    new BoosterFreeze(),
    new BoosterSabotage(),
    new BoosterGoodLuck(),
    new BoosterShield(),
  ]

  static listar(): Booster[] {
    return CatalogoBoosters.todos
  }

  static porId(id: number): Booster | undefined {
    return CatalogoBoosters.todos.find((b) => b.id === id)
  }
}
