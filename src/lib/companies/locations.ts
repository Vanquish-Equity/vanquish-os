export const US_CITIES = [
  "San Francisco, CA", "Los Angeles, CA", "New York, NY", "Miami, FL",
  "Boston, MA", "Austin, TX", "Seattle, WA", "San Diego, CA",
  "Chicago, IL", "Denver, CO", "Palo Alto, CA", "San Jose, CA", "Menlo Park, CA",
  "Mountain View, CA", "Oakland, CA", "Atlanta, GA", "Dallas, TX", "Houston, TX",
  "Washington, DC", "Philadelphia, PA", "Raleigh, NC", "Salt Lake City, UT",
  "Boulder, CO", "Portland, OR", "Nashville, TN", "Phoenix, AZ",
  "Minneapolis, MN", "Pittsburgh, PA", "Detroit, MI", "Tampa, FL",
];

const suggested: Record<string, string[]> = {
  CA: ["Toronto", "Vancouver", "Montréal", "Waterloo"],
  CR: ["San José", "Heredia", "Escazú"],
  GB: ["London", "Cambridge", "Manchester"],
  MX: ["Mexico City", "Guadalajara", "Monterrey"],
  FR: ["Paris", "Lyon"], DE: ["Berlin", "Munich"], ES: ["Madrid", "Barcelona"],
  BR: ["São Paulo", "Rio de Janeiro"], JP: ["Tokyo", "Osaka"], SG: ["Singapore"],
  IL: ["Tel Aviv", "Jerusalem"], AE: ["Dubai", "Abu Dhabi"],
};
const names = new Intl.DisplayNames(["en"], { type: "region" });
export function locationLabel(city: string, country: string) {
  return country === "US" ? city : `${city}, ${names.of(country)}`;
}
export function locationChoices(country: string, query: string) {
  const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const cities = country === "US" ? US_CITIES : (suggested[country] ?? []);
  return cities.filter((city) => normalize(city).includes(normalize(query.trim())));
}

export const countries = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ").map((code) => ({ code, name: names.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

export function locationColors(value: string) {
  const key = value.trim().toLowerCase().replace(/\s*· demo$/, "");
  const index = US_CITIES.findIndex((city) => city.toLowerCase() === key);
  let hue = 0;
  if (index >= 0) hue = Math.round((index * 137.508 + 16) % 360);
  else for (const char of key) hue = (hue * 31 + char.codePointAt(0)!) % 360;
  return { backgroundColor: `hsl(${hue} 75% 91%)`, color: `hsl(${hue} 60% 25%)` };
}
