"""U-Net léger (5 niveaux) pour segmenter le verre dans l'image redressée (0,25 mm/px).

Conçu pour tourner dans le navigateur sans dépendance lourde : uniquement des
convolutions 3x3 / 1x1, ReLU, max-pooling 2x2 et un sur-échantillonnage bilinéaire x2.
Après entraînement, les BatchNorm sont fusionnées dans les convolutions (export.py),
ce qui donne un graphe que le moteur JS (js/nn/unet.js) reproduit à l'identique.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

CH = (8, 16, 32, 48, 64)


class ConvBNReLU(nn.Sequential):
    def __init__(self, cin, cout):
        super().__init__(nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True))


class Block(nn.Sequential):
    def __init__(self, cin, cout):
        super().__init__(ConvBNReLU(cin, cout), ConvBNReLU(cout, cout))


class LensUNet(nn.Module):
    def __init__(self, ch=CH, cin=3):
        super().__init__()
        self.ch = ch
        self.enc = nn.ModuleList()
        c = cin
        for co in ch:
            self.enc.append(Block(c, co))
            c = co
        self.dec = nn.ModuleList()
        for i in range(len(ch) - 2, -1, -1):
            self.dec.append(Block(ch[i + 1] + ch[i], ch[i]))
        self.head = nn.Conv2d(ch[0], 1, 1)

    def forward(self, x):
        skips = []
        for i, blk in enumerate(self.enc):
            x = blk(x)
            if i < len(self.enc) - 1:
                skips.append(x)
                x = F.max_pool2d(x, 2)
        for blk in self.dec:
            s = skips.pop()
            x = F.interpolate(x, size=s.shape[-2:], mode='bilinear', align_corners=False)
            x = blk(torch.cat([x, s], 1))
        return self.head(x)


def count_params(m):
    return sum(p.numel() for p in m.parameters())


if __name__ == '__main__':
    m = LensUNet()
    print('params', count_params(m))
    y = m(torch.randn(1, 3, 320, 448))
    print(y.shape)
