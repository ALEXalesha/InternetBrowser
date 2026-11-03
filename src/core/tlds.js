// Домены верхнего уровня, по которым ввод вида «слово.слово» считается адресом, а не поиском.
// Список ручной: все двухбуквенные домены стран, общие (com, org...), частые новые и
// русскоязычные (рф, рус...), плюс служебные имена локальной сети (local, lan, test...).
// Полный список IANA (~1500 имён) не нужен: незнакомое окончание уходит в поиск,
// а «http://» или «/» в конце всё равно открывают адрес.
'use strict';

const COUNTRY = `ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo bq br bs bt bv
bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo
fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp
ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu mv
mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc
sd se sg sh si sj sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy
uz va vc ve vg vi vn vu wf ws ye yt za zm zw`;

const GENERIC = `com net org info biz edu gov mil int arpa aero asia cat coop jobs mobi museum name post pro tel travel xxx
academy agency app art audio auto bank bar beer best bet bid bike bio black blog blue book box build business buzz cafe
cam camera camp capital car cards care careers cash casino center chat cheap church city click clinic cloud club codes
coffee college community company computer cool cooking credit cymru dance data date dating deals degree delivery design
dev diet digital direct directory discount dog domains download earth eco education email energy engineer engineering
enterprises equipment estate events exchange expert express fail faith family fan fans farm fashion film finance
financial fish fit fitness flights florist football forex forsale foundation fun fund furniture futbol fyi gallery game
games garden gift gifts gives glass global gmbh gold golf graphics gratis green group guide guitars guru health
healthcare help hockey holdings holiday homes horse hospital host hosting house how icu immo inc industries ink
institute insure international investments jetzt jewelry kaufen kim kitchen land law lawyer lease legal life lighting
limited link live llc loan loans lol london love ltd luxury maison management market marketing mba media meme memorial
men menu moda moe mom money monster moscow movie music navy network new news ninja nyc one online ooo page paris
partners parts party pet phd photo photography photos pics pictures pink pizza place plumbing plus poker press
productions promo properties property pub quest racing radio realestate recipes red rehab reise reisen rent rentals
repair report rest restaurant review reviews rich rip rocks run sale salon sarl school schule science security services
shoes shop shopping show singles site ski soccer social software solar solutions space spa sport store stream studio
study style supplies supply support surf surgery swiss systems tattoo tax taxi team tech technology tennis theater
tienda tips tires today tokyo tools top tours town toys trade trading training tube university uno vacations vegas
ventures vet viajes video villas vin vip vision vodka vote voting voyage watch webcam website wedding wiki win wine work
works world wtf xyz yoga zone tatar berlin hamburg amsterdam bayern wien nrw kiwi africa tirol brussels madrid barcelona
quebec scot wales boston miami osaka sydney melbourne istanbul dubai rio lat ong ngo onl mov zip foo google youtube
android chrome play goog amazon apple microsoft windows xbox yandex sber`;

const NATIVE = 'рф рус москва онлайн сайт орг ком дети укр бел срб мкд қаз мон';

// Имена, которые никогда не продаются (RFC 6761 и обычай домашних сетей): адрес и без регистрации.
const LOCAL = 'local localhost test example invalid onion internal lan home';

const TLDS = new Set(`${COUNTRY} ${GENERIC} ${NATIVE} ${LOCAL}`.split(/\s+/).filter(Boolean));

function isKnownTld(label) {
  return TLDS.has(String(label).toLowerCase());
}

module.exports = { TLDS, isKnownTld };
