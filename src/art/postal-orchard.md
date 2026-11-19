# Repainting a postal bough

The [orchard atlas](postal-orchard.webp) is one 512 × 512 sRGB WebP. In the upper row, the hanging cut and the low spreading cut sit side by side. The lower row holds the original colour hedge and the upright cut. Each tree cut carries a silhouette in alpha and the thickness of the paint in grayscale. Leave the gold out of the scan: the [orchard material](../world/postalOrchard.ts) turns that thickness and the direction of sunlight into colour.

For this atlas, the three cuts came from one transparent sheet made with the built-in image generator using the village gouache concept as a reference. The opaque bounds were fitted to 236 × 236 px inside each 256 px cell; the branch radii restore their proportions in the game. The source pigments were normalized separately before packing, so a darker scan doesn't make an entire species look backlit.

<details>
<summary>Original painting prompt</summary>

A production texture sheet for the foliage in the supplied countryside gouache painting. Wide landscape canvas, aspect ratio 3:1. On a transparent background, place exactly THREE SEPARATE isolated gouache foliage masses in a single row of three equal-sized square cells. Each mass centered and fully within its cell with generous transparent gutter on each side; nothing touches. These are branch-end boughs used small on a 3D tree, not finished trees or individual leaves. No trunks, sticks, ground, text, background or cast shadows.

First, left cell: an asymmetrical birch bough with a gently round shoulder on the left and a sagging skirt of three unequal, downward brush tips, a little notch opening in its lower right; paint follows short downward arcs. Second, middle: an old oak limb, a wide low shape made from two connected shelves, one high knuckle and a long blunt lateral reach, chunky broken HORIZONTAL strokes with an irregular flat underside. Third, right: a dense upright linden leader, like an irregular teardrop or cupped hand, with a narrow stepped top, wider lower belly and a wide soft edge on the right; fan a few short paddle-shaped brush marks out from the middle. They should be recognisably different as solid black silhouettes, neither three perpendicular stripes nor three fluffy balls.

Use the reference for the SIZE and opacity of painted marks: simple, quiet contiguous masses built of a handful of broad decisive dry gouache strokes with just a few bristle marks at their outer edge. An ochre-olive and moss green tonal study — 3 adjacent middle green/olive values — soft overhead ambient light, NO yellow stripe across the upper left of each shape, NO baked hard lighting, bottom and edges also fairly close in value: the game will paint the sun itself. No gradients, no smooth vector cutouts, no outlined individual leaves, no watercolor splatter. Hand-painted physical poster paint. The bottom tips are irregular but stay attached to the solid central mass. Transparent negative space everywhere outside the three shapes.

</details>
