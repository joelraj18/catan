import {
  BOARD_SPACES,
  propertyDetails,
  routeDetails,
  utilityDetails,
  rentFor,
  canBuild,
  canSellBuilding,
  sellOneBuilding,
  canSellProperty,
  sellProperty,
  mortgageValue,
  unmortgageCost,
  canMortgage,
  netWorth,
  liquidatableValue,
  hasMonopoly,
} from './estate.js';

describe('estate economy rules', () => {
  describe('rentFor', () => {
    test('returns 0 for unowned or mortgaged property', () => {
      expect(rentFor({}, 1, 7)).toBe(0);
      expect(rentFor({ 1: { owner: 'p1', houses: 0, mortgaged: true } }, 1, 7)).toBe(0);
    });

    test('calculates base rent for single property in group', () => {
      const deeds = { 1: { owner: 'p1', houses: 0, hotel: false, mortgaged: false } };
      // Space 1: Pallava Path, base rent 2000
      expect(rentFor(deeds, 1, 7)).toBe(2000);
    });

    test('doubles base rent when owner has monopoly on undeveloped group', () => {
      // Maroon group: spaces 1 and 3
      const deeds = {
        1: { owner: 'p1', houses: 0, hotel: false, mortgaged: false },
        3: { owner: 'p1', houses: 0, hotel: false, mortgaged: false },
      };
      // Space 1 base rent 2000 * 2 = 4000
      expect(rentFor(deeds, 1, 7)).toBe(4000);
      // Space 3 base rent 4000 * 2 = 8000
      expect(rentFor(deeds, 3, 7)).toBe(8000);
    });

    test('calculates house rents (1-4 houses) and hotel', () => {
      const details = propertyDetails[1]; // [2000, 10000, 30000, 90000, 160000, 250000]
      expect(rentFor({ 1: { owner: 'p1', houses: 1, mortgaged: false } }, 1, 7)).toBe(details.rent[1]);
      expect(rentFor({ 1: { owner: 'p1', houses: 2, mortgaged: false } }, 1, 7)).toBe(details.rent[2]);
      expect(rentFor({ 1: { owner: 'p1', houses: 3, mortgaged: false } }, 1, 7)).toBe(details.rent[3]);
      expect(rentFor({ 1: { owner: 'p1', houses: 4, mortgaged: false } }, 1, 7)).toBe(details.rent[4]);
      expect(rentFor({ 1: { owner: 'p1', houses: 4, hotel: true, mortgaged: false } }, 1, 7)).toBe(details.rent[5]);
    });

    test('calculates route rents based on routes owned (1-4)', () => {
      // Route spaces: 5, 15, 25, 35
      const deeds1 = { 5: { owner: 'p1', mortgaged: false } };
      expect(rentFor(deeds1, 5, 7)).toBe(25000);

      const deeds2 = {
        5: { owner: 'p1', mortgaged: false },
        15: { owner: 'p1', mortgaged: false },
      };
      expect(rentFor(deeds2, 5, 7)).toBe(50000);

      const deeds3 = {
        5: { owner: 'p1', mortgaged: false },
        15: { owner: 'p1', mortgaged: false },
        25: { owner: 'p1', mortgaged: false },
      };
      expect(rentFor(deeds3, 5, 7)).toBe(100000);

      const deeds4 = {
        5: { owner: 'p1', mortgaged: false },
        15: { owner: 'p1', mortgaged: false },
        25: { owner: 'p1', mortgaged: false },
        35: { owner: 'p1', mortgaged: false },
      };
      expect(rentFor(deeds4, 5, 7)).toBe(200000);
    });

    test('calculates utility rents (4x or 10x dice total * 1000)', () => {
      // Utility spaces: 12, 28
      const deeds1 = { 12: { owner: 'p1', mortgaged: false } };
      // 1 utility owned: 4 * 7 * 1000 = 28000
      expect(rentFor(deeds1, 12, 7)).toBe(28000);

      const deeds2 = {
        12: { owner: 'p1', mortgaged: false },
        28: { owner: 'p1', mortgaged: false },
      };
      // Both utilities owned: 10 * 7 * 1000 = 70000
      expect(rentFor(deeds2, 12, 7)).toBe(70000);
    });
  });

  describe('monopoly and building rules', () => {
    test('hasMonopoly verifies full group ownership', () => {
      const deedsPartial = { 1: { owner: 'p1' } };
      expect(hasMonopoly('p1', 1, deedsPartial)).toBe(false);

      const deedsFull = { 1: { owner: 'p1' }, 3: { owner: 'p1' } };
      expect(hasMonopoly('p1', 1, deedsFull)).toBe(true);
      expect(hasMonopoly('p2', 1, deedsFull)).toBe(false);
    });

    test('canBuild enforces monopoly, no mortgages, max 5 builds, and even building', () => {
      const deeds = {
        1: { owner: 'p1', houses: 0, hotel: false, mortgaged: false },
        3: { owner: 'p1', houses: 0, hotel: false, mortgaged: false },
      };
      // Can build 1st house on space 1 or 3
      expect(canBuild(deeds, 1)).toBe(true);
      expect(canBuild(deeds, 3)).toBe(true);

      // Once space 1 has 1 house, cannot build on space 1 again until space 3 has 1 house
      deeds[1].houses = 1;
      expect(canBuild(deeds, 1)).toBe(false);
      expect(canBuild(deeds, 3)).toBe(true);

      // If one property is mortgaged, cannot build on any in the group
      deeds[3].mortgaged = true;
      expect(canBuild(deeds, 3)).toBe(false);
      deeds[3].mortgaged = false;

      // When both have 4 houses, can build hotel (5th build)
      deeds[1].houses = 4;
      deeds[3].houses = 4;
      expect(canBuild(deeds, 1)).toBe(true);

      // Once hotel built, cannot build more
      deeds[1].hotel = true;
      expect(canBuild(deeds, 1)).toBe(false);
    });

    test('canSellBuilding and sellOneBuilding refund 50% of house cost and obey even selling', () => {
      const deeds = {
        1: { owner: 'p1', houses: 2, hotel: false, mortgaged: false },
        3: { owner: 'p1', houses: 1, hotel: false, mortgaged: false },
      };
      // Can sell from space 1 (which has 2 houses), but not space 3 (which has 1)
      expect(canSellBuilding(deeds, 1)).toBe(true);
      expect(canSellBuilding(deeds, 3)).toBe(false);

      const result = sellOneBuilding(deeds, 1);
      expect(result).not.toBeNull();
      // Space 1 house cost is 50,000 -> 50% refund = 25,000
      expect(result.cash).toBe(25000);
      expect(result.updatedDeeds[1].houses).toBe(1);

      // Hotel sale downgrades to 4 houses
      const hotelDeeds = {
        1: { owner: 'p1', houses: 4, hotel: true, mortgaged: false },
        3: { owner: 'p1', houses: 4, hotel: true, mortgaged: false },
      };
      const hotelResult = sellOneBuilding(hotelDeeds, 1);
      expect(hotelResult.cash).toBe(25000);
      expect(hotelResult.updatedDeeds[1].hotel).toBe(false);
      expect(hotelResult.updatedDeeds[1].houses).toBe(4);
    });
  });

  describe('property selling and mortgaging', () => {
    test('canSellProperty prohibits selling if mortgaged or if buildings exist in group', () => {
      const deeds = {
        1: { owner: 'p1', houses: 1, mortgaged: false },
        3: { owner: 'p1', houses: 0, mortgaged: false },
      };
      // Space 3 has 0 houses, but space 1 in the group has 1 house -> cannot sell space 3 yet
      expect(canSellProperty(deeds, 3)).toBe(false);

      deeds[1].houses = 0;
      expect(canSellProperty(deeds, 3)).toBe(true);

      deeds[3].mortgaged = true;
      expect(canSellProperty(deeds, 3)).toBe(false);
    });

    test('sellProperty refunds 50% of purchase price and removes deed', () => {
      const deeds = {
        1: { owner: 'p1', houses: 0, hotel: false, mortgaged: false },
      };
      // Space 1 price is 60,000 -> refund 30,000
      const res = sellProperty(deeds, 1);
      expect(res.cash).toBe(30000);
      expect(res.updatedDeeds[1]).toBeUndefined();
    });

    test('mortgageValue and unmortgageCost with 10% interest', () => {
      // Space 1 mortgage value is 30,000
      expect(mortgageValue(1)).toBe(30000);
      // Unmortgage is 30000 * 1.1 = 33000
      expect(unmortgageCost(1)).toBe(33000);

      // Route mortgage: 100,000 -> unmortgage: 110,000
      expect(mortgageValue(5)).toBe(100000);
      expect(unmortgageCost(5)).toBe(110000);
    });

    test('canMortgage checks no buildings in group', () => {
      const deeds = {
        1: { owner: 'p1', houses: 1, mortgaged: false },
        3: { owner: 'p1', houses: 0, mortgaged: false },
      };
      expect(canMortgage(deeds, 3)).toBe(false);
      deeds[1].houses = 0;
      expect(canMortgage(deeds, 3)).toBe(true);
    });
  });

  describe('netWorth and liquidatableValue', () => {
    test('netWorth sums cash, unmortgaged property, improvements at 50%, and mortgaged property value - mortgage', () => {
      const balances = { p1: 500000 };
      const deeds = {
        // Space 1: price 60000, 2 houses (cost 50000 each -> 50% is 25000 each = 50000)
        1: { owner: 'p1', houses: 2, hotel: false, mortgaged: false },
        // Space 3: price 60000, mortgage 30000, mortgaged
        3: { owner: 'p1', houses: 0, hotel: false, mortgaged: true },
        // Route 5: price 200000, unmortgaged
        5: { owner: 'p1', mortgaged: false },
      };

      // Space 1: 60,000 + (2 * 50,000 * 0.5) = 110,000
      // Space 3 (mortgaged): 60,000 - 30,000 = 30,000
      // Route 5: 200,000
      // Cash: 500,000
      // Total: 500,000 + 110,000 + 30,000 + 200,000 = 840,000
      expect(netWorth('p1', balances, deeds)).toBe(840000);
    });

    test('liquidatableValue calculates cash raiseable by selling buildings at 50% and unmortgaged properties at 50%', () => {
      const deeds = {
        // Space 1: 2 houses -> 2 * 25000 = 50000 buildings + 50% of 60000 = 30000 property = 80000
        1: { owner: 'p1', houses: 2, hotel: false, mortgaged: false },
        // Space 3: mortgaged -> 0 raiseable
        3: { owner: 'p1', houses: 0, hotel: false, mortgaged: true },
        // Route 5: 50% of 200000 = 100000
        5: { owner: 'p1', mortgaged: false },
      };

      // Space 1: 50,000 (houses) + 30,000 (property) = 80,000
      // Space 3: 0
      // Route 5: 100,000
      // Total: 180,000
      expect(liquidatableValue('p1', deeds)).toBe(180000);
    });
  });
});
