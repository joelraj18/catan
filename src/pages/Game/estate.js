// Pure economy rules for MANAPALLY.
// No React, no timers, easy to unit test.

import { BOARD_SPACES } from './boardData';

export const ROUTE_SPACES = [5, 15, 25, 35];
export const UTILITY_SPACES = [12, 28];

export const propertyDetails = {
  1: { rent: [2000, 10000, 30000, 90000, 160000, 250000], houseCost: 50000, mortgage: 30000, price: 60000 },
  3: { rent: [4000, 20000, 60000, 180000, 320000, 450000], houseCost: 50000, mortgage: 30000, price: 60000 },
  6: { rent: [6000, 30000, 90000, 270000, 400000, 550000], houseCost: 50000, mortgage: 50000, price: 100000 },
  8: { rent: [6000, 30000, 90000, 270000, 400000, 550000], houseCost: 50000, mortgage: 50000, price: 100000 },
  9: { rent: [8000, 40000, 100000, 300000, 450000, 600000], houseCost: 50000, mortgage: 60000, price: 120000 },
  11: { rent: [10000, 50000, 150000, 450000, 625000, 750000], houseCost: 100000, mortgage: 70000, price: 140000 },
  13: { rent: [10000, 50000, 150000, 450000, 625000, 750000], houseCost: 100000, mortgage: 70000, price: 140000 },
  14: { rent: [12000, 60000, 180000, 500000, 700000, 900000], houseCost: 100000, mortgage: 80000, price: 160000 },
  16: { rent: [14000, 70000, 200000, 550000, 750000, 950000], houseCost: 100000, mortgage: 90000, price: 180000 },
  18: { rent: [14000, 70000, 200000, 550000, 750000, 950000], houseCost: 100000, mortgage: 90000, price: 180000 },
  19: { rent: [16000, 80000, 220000, 600000, 800000, 1000000], houseCost: 100000, mortgage: 100000, price: 200000 },
  21: { rent: [18000, 90000, 250000, 700000, 875000, 1050000], houseCost: 150000, mortgage: 110000, price: 220000 },
  23: { rent: [18000, 90000, 250000, 700000, 875000, 1050000], houseCost: 150000, mortgage: 110000, price: 220000 },
  24: { rent: [20000, 100000, 300000, 750000, 925000, 1100000], houseCost: 150000, mortgage: 120000, price: 240000 },
  26: { rent: [22000, 110000, 330000, 800000, 975000, 1150000], houseCost: 150000, mortgage: 130000, price: 260000 },
  27: { rent: [22000, 110000, 330000, 800000, 975000, 1150000], houseCost: 150000, mortgage: 130000, price: 260000 },
  29: { rent: [24000, 120000, 360000, 850000, 1025000, 1200000], houseCost: 150000, mortgage: 140000, price: 280000 },
  31: { rent: [26000, 130000, 390000, 900000, 1100000, 1275000], houseCost: 200000, mortgage: 150000, price: 300000 },
  32: { rent: [26000, 130000, 390000, 900000, 1100000, 1275000], houseCost: 200000, mortgage: 150000, price: 300000 },
  34: { rent: [28000, 150000, 450000, 1000000, 1200000, 1400000], houseCost: 200000, mortgage: 160000, price: 320000 },
  37: { rent: [35000, 175000, 500000, 1100000, 1300000, 1500000], houseCost: 200000, mortgage: 175000, price: 350000 },
  39: { rent: [50000, 200000, 600000, 1400000, 1700000, 2000000], houseCost: 200000, mortgage: 200000, price: 400000 },
};

export const routeDetails = {
  price: 200000,
  rent: [25000, 50000, 100000, 200000], // 1, 2, 3, 4 routes owned
  mortgage: 100000,
};

export const utilityDetails = {
  price: 150000,
  multipliers: [4, 10], // one utility owned, both owned
  perPip: 1000,
  mortgage: 75000,
};

// The board lives in boardData.js; re-exported so these helpers default to it.
export { BOARD_SPACES };

/**
 * Compute rent owed when landing on `spaceId`.
 * @param deeds { [spaceId]: { owner, houses, hotel, mortgaged } }
 * @param spaceId number (0-39)
 * @param diceTotal number (sum of two dice)
 * @param spaces array of 40 space objects
 * @returns number
 */
export const rentFor = (deeds, spaceId, diceTotal, spaces = BOARD_SPACES) => {
  const deed = deeds[spaceId];
  if (!deed || deed.mortgaged) return 0;

  const space = spaces[spaceId];
  if (!space) return 0;

  switch (space.type) {
    case 'property': {
      const group = space.colorGroup;
      const groupSpaces = spaces.filter((s) => s.type === 'property' && s.colorGroup === group);
      const allOwned = groupSpaces.every((s) => deeds[s.id] && deeds[s.id].owner === deed.owner);
      const details = propertyDetails[spaceId];
      if (!details) return 0;

      if (deed.hotel) {
        return details.rent[5];
      }
      if (deed.houses > 0) {
        return details.rent[deed.houses];
      }
      // Base rent, doubled if the owner holds the full group with 0 houses across the group
      return allOwned ? details.rent[0] * 2 : details.rent[0];
    }
    case 'route': {
      const ownedCount = ROUTE_SPACES.filter(
        (id) => deeds[id] && deeds[id].owner === deed.owner,
      ).length;
      return routeDetails.rent[Math.max(0, Math.min(ownedCount - 1, 3))] || 0;
    }
    case 'utility': {
      const ownedCount = UTILITY_SPACES.filter(
        (id) => deeds[id] && deeds[id].owner === deed.owner,
      ).length;
      const multiplier = utilityDetails.multipliers[ownedCount === 2 ? 1 : 0];
      return multiplier * diceTotal * utilityDetails.perPip;
    }
    default:
      return 0;
  }
};

/**
 * Get all space IDs in the same color group as `spaceId`.
 */
export const getGroupSpaceIds = (spaceId, spaces = BOARD_SPACES) => {
  const space = spaces[spaceId];
  if (!space || space.type !== 'property') return [];
  return spaces
    .filter((s) => s.type === 'property' && s.colorGroup === space.colorGroup)
    .map((s) => s.id);
};

/**
 * Check if player owns all properties in the color group.
 */
export const hasMonopoly = (playerId, spaceId, deeds, spaces = BOARD_SPACES) => {
  const groupIds = getGroupSpaceIds(spaceId, spaces);
  if (groupIds.length === 0) return false;
  return groupIds.every((id) => deeds[id] && deeds[id].owner === playerId);
};

/**
 * Determine whether a house/hotel can be built on `spaceId`.
 * Requires monopoly, no mortgages in group, max 5 builds (hotel), and even-build rule.
 */
export const canBuild = (deeds, spaceId, spaces = BOARD_SPACES) => {
  const deed = deeds[spaceId];
  if (!deed || deed.mortgaged) return false;
  const space = spaces[spaceId];
  if (!space || space.type !== 'property') return false;

  const groupIds = getGroupSpaceIds(spaceId, spaces);
  if (!hasMonopoly(deed.owner, spaceId, deeds, spaces)) return false;

  // No property in group may be mortgaged
  if (groupIds.some((id) => deeds[id] && deeds[id].mortgaged)) return false;

  const currentBuild = deed.hotel ? 5 : (deed.houses || 0);
  if (currentBuild >= 5) return false; // Already hotel

  // Even-building rule: cannot build on this property if any other in group has fewer builds
  const groupBuilds = groupIds.map((id) => {
    const d = deeds[id];
    return d ? (d.hotel ? 5 : (d.houses || 0)) : 0;
  });
  const minBuild = Math.min(...groupBuilds);
  return currentBuild === minBuild;
};

/**
 * Determine whether a house/hotel can be sold back to the Bank.
 * Preserves even-building rule (cannot sell from this property if any other in group has more builds).
 */
export const canSellBuilding = (deeds, spaceId, spaces = BOARD_SPACES) => {
  const deed = deeds[spaceId];
  if (!deed) return false;
  const space = spaces[spaceId];
  if (!space || space.type !== 'property') return false;

  const currentBuild = deed.hotel ? 5 : (deed.houses || 0);
  if (currentBuild === 0) return false;

  const groupIds = getGroupSpaceIds(spaceId, spaces);
  const groupBuilds = groupIds.map((id) => {
    const d = deeds[id];
    return d ? (d.hotel ? 5 : (d.houses || 0)) : 0;
  });
  const maxBuild = Math.max(...groupBuilds);
  return currentBuild === maxBuild;
};

/**
 * Sell 1 house (or hotel -> 4 houses) back to the Bank for 50% of build cost.
 * @returns {{ cash: number, updatedDeeds: object } | null}
 */
export const sellOneBuilding = (deeds, spaceId, spaces = BOARD_SPACES) => {
  if (!canSellBuilding(deeds, spaceId, spaces)) return null;
  const deed = deeds[spaceId];
  const details = propertyDetails[spaceId];
  if (!details) return null;

  const refund = details.houseCost * 0.5;
  let newHouses = deed.houses || 0;
  let newHotel = false;

  if (deed.hotel) {
    newHotel = false;
    newHouses = 4;
  } else {
    newHouses = Math.max(0, newHouses - 1);
  }

  return {
    cash: refund,
    updatedDeeds: {
      ...deeds,
      [spaceId]: {
        ...deed,
        houses: newHouses,
        hotel: newHotel,
      },
    },
  };
};

/**
 * Check if unimproved, unmortgaged property can be sold back to the Bank.
 * Buildings must be sold first.
 */
export const canSellProperty = (deeds, spaceId, spaces = BOARD_SPACES) => {
  const deed = deeds[spaceId];
  if (!deed || deed.mortgaged) return false;
  const space = spaces[spaceId];
  if (!space) return false;

  // If property, must have no houses/hotels anywhere in the color group
  if (space.type === 'property') {
    const groupIds = getGroupSpaceIds(spaceId, spaces);
    const hasAnyBuildings = groupIds.some(
      (id) => deeds[id] && ((deeds[id].houses && deeds[id].houses > 0) || deeds[id].hotel),
    );
    if (hasAnyBuildings) return false;
  }

  return true;
};

/**
 * Sell an unimproved, unmortgaged property back to the Bank for 50% of purchase price.
 * @returns {{ cash: number, updatedDeeds: object } | null}
 */
export const sellProperty = (deeds, spaceId, spaces = BOARD_SPACES) => {
  if (!canSellProperty(deeds, spaceId, spaces)) return null;
  const space = spaces[spaceId];
  if (!space) return null;

  let price = space.price || 0;
  if (space.type === 'property' && propertyDetails[spaceId]) {
    price = propertyDetails[spaceId].price;
  } else if (space.type === 'route') {
    price = routeDetails.price;
  } else if (space.type === 'utility') {
    price = utilityDetails.price;
  }

  const refund = price * 0.5;
  const updatedDeeds = { ...deeds };
  delete updatedDeeds[spaceId];

  return { cash: refund, updatedDeeds };
};

/**
 * Mortgage value: amount received when mortgaging.
 */
export const mortgageValue = (spaceId, spaces = BOARD_SPACES) => {
  const space = spaces[spaceId];
  if (!space) return 0;
  if (space.type === 'property' && propertyDetails[spaceId]) {
    return propertyDetails[spaceId].mortgage;
  }
  if (space.type === 'route') return routeDetails.mortgage;
  if (space.type === 'utility') return utilityDetails.mortgage;
  return 0;
};

/**
 * Unmortgage cost: mortgage value + 10% interest.
 */
export const unmortgageCost = (spaceId, spaces = BOARD_SPACES) => {
  const base = mortgageValue(spaceId, spaces);
  return Math.floor(base * 1.1);
};

/**
 * Check if property can be mortgaged (must be owned, unmortgaged, and unimproved across its group).
 */
export const canMortgage = (deeds, spaceId, spaces = BOARD_SPACES) => {
  const deed = deeds[spaceId];
  if (!deed || deed.mortgaged) return false;
  const space = spaces[spaceId];
  if (!space) return false;

  if (space.type === 'property') {
    const groupIds = getGroupSpaceIds(spaceId, spaces);
    const hasAnyBuildings = groupIds.some(
      (id) => deeds[id] && ((deeds[id].houses && deeds[id].houses > 0) || deeds[id].hotel),
    );
    if (hasAnyBuildings) return false;
  }
  return true;
};

/**
 * Net worth of a player.
 * - Cash includes any mortgage money already received.
 * - Unmortgaged property: appraised purchase price + improvement value at 50% resale.
 * - Mortgaged property: property value − outstanding mortgage principal (never below 0).
 * - Uses 50% resale values for buildings.
 */
export const netWorth = (playerId, balances, deeds, spaces = BOARD_SPACES) => {
  let worth = balances[playerId] || 0;

  Object.entries(deeds).forEach(([idStr, deed]) => {
    if (!deed || deed.owner !== playerId) return;
    const spaceId = Number(idStr);
    const space = spaces[spaceId];
    if (!space) return;

    let basePrice = space.price || 0;
    let mVal = 0;
    let buildingVal = 0;

    if (space.type === 'property') {
      const detail = propertyDetails[spaceId];
      if (detail) {
        basePrice = detail.price;
        mVal = detail.mortgage;
        if (deed.hotel) {
          buildingVal = 5 * detail.houseCost * 0.5;
        } else if (deed.houses > 0) {
          buildingVal = deed.houses * detail.houseCost * 0.5;
        }
      }
    } else if (space.type === 'route') {
      basePrice = routeDetails.price;
      mVal = routeDetails.mortgage;
    } else if (space.type === 'utility') {
      basePrice = utilityDetails.price;
      mVal = utilityDetails.mortgage;
    }

    if (deed.mortgaged) {
      worth += Math.max(0, basePrice - mVal);
    } else {
      worth += basePrice + buildingVal;
    }
  });

  return worth;
};

/**
 * Liquidatable value: total cash a player can raise by selling all buildings at 50%
 * and mortgaging / selling unmortgaged properties.
 */
export const liquidatableValue = (playerId, deeds, spaces = BOARD_SPACES) => {
  let raiseable = 0;

  Object.entries(deeds).forEach(([idStr, deed]) => {
    if (!deed || deed.owner !== playerId) return;
    const spaceId = Number(idStr);
    const space = spaces[spaceId];
    if (!space) return;

    if (space.type === 'property') {
      const detail = propertyDetails[spaceId];
      if (detail) {
        if (deed.hotel) {
          raiseable += 5 * detail.houseCost * 0.5;
        } else if (deed.houses > 0) {
          raiseable += deed.houses * detail.houseCost * 0.5;
        }
      }
    }

    // If unmortgaged, can be mortgaged or sold to bank for 50%
    if (!deed.mortgaged) {
      let price = space.price || 0;
      if (space.type === 'property' && propertyDetails[spaceId]) {
        price = propertyDetails[spaceId].price;
      } else if (space.type === 'route') {
        price = routeDetails.price;
      } else if (space.type === 'utility') {
        price = utilityDetails.price;
      }
      // Selling gives 50%, mortgaging gives mortgage value
      // Player can sell back to bank for 50% of price
      raiseable += price * 0.5;
    }
  });

  return raiseable;
};
