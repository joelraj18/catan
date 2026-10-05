import { BOARD_SPACES } from '../Game/boardData';

const FAMILY_NAMES = {
  maroon: 'Maroon',
  peacock: 'Peacock',
  rose: 'Rose',
  saffron: 'Saffron',
  kumkum: 'Kumkum',
  turmeric: 'Turmeric',
  emerald: 'Emerald',
  indigo: 'Indigo',
};

const rupees = (amount) => `₹${amount.toLocaleString('en-IN')}`;

// Group the property spaces by colour family in board order.
const families = BOARD_SPACES.filter((space) => space.type === 'property').reduce(
  (groups, space) => {
    const group = groups.find((entry) => entry.key === space.colorGroup);

    if (group) {
      group.districts.push(space);
    } else {
      groups.push({ key: space.colorGroup, districts: [space] });
    }

    return groups;
  },
  [],
);

const priceRange = (districts) => {
  const prices = districts.map((district) => district.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);

  return low === high ? rupees(low) : `${rupees(low)} to ${rupees(high)}`;
};

export default function DistrictFamilies() {
  return (
    <section className="home-section home-section--white" id="districts" aria-labelledby="districts-heading">
      <div className="section-inner">
        <header className="section-head reveal">
          <h2 id="districts-heading">
            District families <span>Complete a colour to start building</span>
          </h2>
        </header>

        <div className="family-grid">
          {families.map((family, index) => (
            <article
              className="family-card reveal"
              key={family.key}
              style={{
                '--family': `var(--color-${family.key})`,
                '--reveal-delay': `${(index % 4) * 0.06}s`,
              }}
            >
              <div className="family-card-head">
                <span className="family-swatch" aria-hidden="true" />
                <h3>{FAMILY_NAMES[family.key]}</h3>
                <span className="family-count">{family.districts.length} districts</span>
              </div>

              <ul>
                {family.districts.map((district) => (
                  <li key={district.id}>{district.name}</li>
                ))}
              </ul>

              <p className="family-price">{priceRange(family.districts)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
