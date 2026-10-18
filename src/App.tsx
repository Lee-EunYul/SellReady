import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'

type Category = '헤드폰' | '태블릿' | '게임기' | '책' | '가방' | '기타'
type ConditionStatus = '정상' | '사용감 있음' | '문제 있음' | '확인 필요'

type Product = {
  id: string
  name: string
  brand: string
  modelName: string
  category: Category
  purchaseDate: string
  purchasePrice: number
  currentPrice?: number
  priceSource?: string
  priceHistory: PriceSnapshot[]
  condition: ConditionStatus
  components: string
  note: string
  imageDataUrls: string[]
  checks: Record<string, ConditionStatus>
  checkNotes: Record<string, string>
  checkImages: Record<string, string[]>
  preparation: SellPreparation
  trustSheet: TrustSheet
}

type PriceSnapshot = {
  price: number
  checkedAt: string
  source: string
}

type SellPreparation = {
  photos: Record<string, boolean>
  title: string
  description: string
}

type TrustField = 'identity' | 'usage' | 'condition' | 'components' | 'issues' | 'checkedAt' | 'photos'

type TrustSheet = {
  isActive: boolean
  publicToken: string
  publishedFields: TrustField[]
  checkedAt?: string
}

type Account = {
  email: string
  name: string
}

const categoryChecks: Record<Category, string[]> = {
  헤드폰: ['전원', '충전', '블루투스', '좌우 음향', '버튼', '이어패드', '외관'],
  태블릿: ['화면', '터치', '카메라', '스피커', '충전', '버튼', '외관'],
  게임기: ['전원', '화면', '컨트롤러', '버튼', '스피커', '네트워크', '외관'],
  책: ['표지', '필기', '찢어짐', '변색', '이름 기입'],
  가방: ['외부 오염', '내부 오염', '지퍼', '스트랩', '모서리 마모'],
  기타: ['전원 또는 작동', '외관', '구성품', '기능 확인'],
}

const photoGuides: Record<Category, string[]> = {
  헤드폰: ['제품 전체', '제품 좌측', '제품 우측', '이어패드', '모델명', '구성품 전체'],
  태블릿: ['제품 전체', '화면 켜짐', '뒷면과 모서리', '모델명', '구성품 전체'],
  게임기: ['본체 전체', '화면 또는 전원', '컨트롤러', '포트와 외관', '구성품 전체'],
  책: ['표지와 뒤표지', '책등', '내부 상태', '필기 또는 훼손', '부록'],
  가방: ['가방 전체', '앞면과 뒷면', '내부', '모서리와 스트랩', '지퍼와 구성품'],
  기타: ['제품 전체', '모델명', '주요 기능', '사용감 또는 하자', '구성품 전체'],
}

const todayDate = new Date().toISOString().slice(0, 10)
const defaultTrustFields: TrustField[] = ['identity', 'usage', 'condition', 'components', 'issues', 'checkedAt', 'photos']

const sampleProducts: Product[] = [{
  id: 'sample-headphones', name: 'WH-1000XM5', brand: 'Sony', modelName: 'WH-1000XM5', category: '헤드폰',
  purchaseDate: '2024-08-20', purchasePrice: 420000, currentPrice: 359000, priceSource: '샘플 데이터 · 실제 가격 아님',
  priceHistory: [
    { price: 389000, checkedAt: '2026-06-10', source: '샘플 기록' },
    { price: 379000, checkedAt: '2026-07-08', source: '샘플 기록' },
    { price: 359000, checkedAt: '2026-09-23', source: '샘플 기록' },
  ],
  condition: '사용감 있음', components: '본체, 케이스', note: '이어패드 사용감 있음', imageDataUrls: [],
  checks: { 전원: '정상', 충전: '정상', 블루투스: '정상', '좌우 음향': '정상', 버튼: '정상', 이어패드: '사용감 있음', 외관: '사용감 있음' },
  checkNotes: { 이어패드: '쿠션에 사용감이 있어 사진으로 공개할 예정' }, checkImages: {},
  preparation: { photos: { '제품 전체': true, '이어패드': true }, title: 'Sony WH-1000XM5 헤드폰 판매합니다', description: '' },
  trustSheet: { isActive: false, publicToken: 'sample-trust-sheet', publishedFields: defaultTrustFields, checkedAt: '2026-09-23' },
}]

function formatPrice(price?: number) { return price === undefined ? '확인 필요' : `${price.toLocaleString('ko-KR')}원` }

function getUsageDuration(purchaseDate: string) {
  const start = new Date(`${purchaseDate}T00:00:00`)
  const today = new Date()
  let months = (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth()
  if (today.getDate() < start.getDate()) months -= 1
  if (months < 0) return '아직 사용 전'
  return `${Math.floor(months / 12) ? `${Math.floor(months / 12)}년 ` : ''}${months % 12}개월`
}

function createChecks(category: Category) { return Object.fromEntries(categoryChecks[category].map((check) => [check, '확인 필요'])) as Record<string, ConditionStatus> }
function createCheckNotes(category: Category) { return Object.fromEntries(categoryChecks[category].map((check) => [check, ''])) as Record<string, string> }
function createCheckImages(category: Category) { return Object.fromEntries(categoryChecks[category].map((check) => [check, []])) as Record<string, string[]> }
function createPreparation(category: Category): SellPreparation { return { photos: Object.fromEntries(photoGuides[category].map((guide) => [guide, false])), title: '', description: '' } }
function createTrustSheet(): TrustSheet { return { isActive: false, publicToken: crypto.randomUUID(), publishedFields: defaultTrustFields, checkedAt: undefined } }
function buildListing(product: Product) { const issues = Object.entries(product.checks).filter(([, status]) => status === '사용감 있음' || status === '문제 있음').map(([item, status]) => `${item} ${status}${product.checkNotes[item] ? ` (${product.checkNotes[item]})` : ''}`).join(', '); const details = [`구매시기: ${product.purchaseDate}`, `사용기간: ${getUsageDuration(product.purchaseDate)}`, `상태: ${product.condition}`, `구성품: ${product.components || '미입력'}`]; if (issues) details.push(`공개사항: ${issues}`); return { title: `${product.brand ? `${product.brand} ` : ''}${product.name} 판매합니다`, description: `${details.join('\n')}\n\n직접 확인한 제품 상태를 바탕으로 작성한 판매글 초안입니다. 구매 전 사진과 상태를 함께 확인해주세요.` } }
function readJson<T>(raw: string | null, fallback: T): T { if (!raw) return fallback; try { return JSON.parse(raw) as T } catch { return fallback } }
function normalizeProducts(raw: string | null): Product[] | null { const parsed = readJson<unknown>(raw, null); if (!Array.isArray(parsed)) return null; return parsed.map((product) => { const item = product as Product; return { ...item, imageDataUrls: item.imageDataUrls ?? [], checkNotes: item.checkNotes ?? createCheckNotes(item.category), checkImages: item.checkImages ?? createCheckImages(item.category), priceHistory: item.priceHistory ?? [], preparation: item.preparation ?? createPreparation(item.category), trustSheet: item.trustSheet ?? createTrustSheet() } }) }
function findPublicProduct(token: string): Product | undefined { for (let index = 0; index < localStorage.length; index += 1) { const key = localStorage.key(index); if (!key?.startsWith('sellready-products:')) continue; const products = normalizeProducts(localStorage.getItem(key)); const product = products?.find((item) => item.trustSheet.publicToken === token && item.trustSheet.isActive); if (product) return product } return undefined }

function App() {
  const [account, setAccount] = useState<Account | null>(() => readJson<Account | null>(localStorage.getItem('sellready-account'), null))
  const [products, setProducts] = useState<Product[]>(() => normalizeProducts(localStorage.getItem('sellready-products')) ?? sampleProducts)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'vault' | 'condition' | 'sell' | 'trust'>('vault')
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'전체' | Category>('전체')

  useEffect(() => { if (!account) return; try { localStorage.setItem(`sellready-products:${account.email}`, JSON.stringify(products)) } catch { console.error('SellReady data could not be saved.') } }, [account, products])

  const selectedProduct = products.find((product) => product.id === selectedId) ?? products[0]
  const filteredProducts = products.filter((product) => {
    const query = searchQuery.trim().toLowerCase()
    const matchesQuery = !query || [product.name, product.brand, product.modelName].some((value) => value.toLowerCase().includes(query))
    return matchesQuery && (categoryFilter === '전체' || product.category === categoryFilter)
  })
  const completedChecks = selectedProduct ? Object.values(selectedProduct.checks).filter((status) => status !== '확인 필요').length : 0
  const totalChecks = selectedProduct ? Object.keys(selectedProduct.checks).length : 0
  const completedPhotos = selectedProduct ? Object.values(selectedProduct.preparation.photos).filter(Boolean).length : 0
  const totalPhotos = selectedProduct ? Object.keys(selectedProduct.preparation.photos).length : 0
  const readiness = selectedProduct && totalChecks + totalPhotos ? Math.round(((completedChecks + completedPhotos) / (totalChecks + totalPhotos)) * 100) : 0

  function updateProduct(updated: Product) { setProducts((current) => current.map((product) => product.id === updated.id ? updated : product)) }

  function handleLogin(nextAccount: Account) {
    const accountKey = `sellready-products:${nextAccount.email}`
    const existing = normalizeProducts(localStorage.getItem(accountKey))
    const legacy = normalizeProducts(localStorage.getItem('sellready-products'))
    setProducts(existing ?? legacy ?? sampleProducts)
    setAccount(nextAccount)
    try { localStorage.setItem('sellready-account', JSON.stringify(nextAccount)) } catch { console.error('SellReady account could not be saved.') }
    setSelectedId(null)
  }
  function handleLogout() { setAccount(null); localStorage.removeItem('sellready-account'); setActiveView('vault') }

  function openCreate() { setEditingId(null); setIsFormOpen(true) }
  function openEdit() { if (selectedProduct) { setEditingId(selectedProduct.id); setIsFormOpen(true) } }
  function deleteSelected() {
    if (!selectedProduct || !window.confirm(`'${selectedProduct.name}'을(를) 삭제할까요?`)) return
    setProducts((current) => current.filter((product) => product.id !== selectedProduct.id))
    setSelectedId(null)
    setActiveView('vault')
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const category = form.get('category') as Category
    const values = { name: String(form.get('name')), brand: String(form.get('brand')), modelName: String(form.get('modelName')), category, purchaseDate: String(form.get('purchaseDate')), purchasePrice: Number(form.get('purchasePrice')), components: String(form.get('components') || ''), note: String(form.get('note') || '') }
    if (editingId) {
      const existing = products.find((product) => product.id === editingId)
      if (!existing) return
      updateProduct({ ...existing, ...values, checks: values.category === existing.category ? existing.checks : createChecks(values.category), checkNotes: values.category === existing.category ? existing.checkNotes : createCheckNotes(values.category), checkImages: values.category === existing.category ? existing.checkImages : createCheckImages(values.category), preparation: values.category === existing.category ? existing.preparation : createPreparation(values.category) })
      setSelectedId(existing.id)
    } else {
        const product: Product = { id: crypto.randomUUID(), ...values, imageDataUrls: [], condition: '확인 필요', checks: createChecks(category), checkNotes: createCheckNotes(category), checkImages: createCheckImages(category), priceHistory: [], preparation: createPreparation(category), trustSheet: createTrustSheet() }
      setProducts((current) => [product, ...current]); setSelectedId(product.id)
    }
    setEditingId(null); setIsFormOpen(false); event.currentTarget.reset()
  }

  const publicToken = window.location.pathname.startsWith('/trust/') ? window.location.pathname.split('/')[2] : undefined
  if (publicToken) return <PublicTrustSheet product={findPublicProduct(publicToken)} />
  if (!account) return <AuthView onLogin={handleLogin} />

  return (
    <div className="app-shell">
      <aside className="sidebar"><div className="brand"><span className="brand-mark">S</span><span>SellReady</span></div><p className="sidebar-kicker">MY SPACE</p><nav><button className={activeView === 'vault' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('vault')}>My Vault <span>{products.length}</span></button><button className={activeView === 'condition' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('condition')}>Condition Lab</button><button className={activeView === 'sell' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('sell')}>Sell Studio</button><button className={activeView === 'trust' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveView('trust')}>Trust Sheet</button></nav><div className="sidebar-footer"><span className="avatar">{account.name.slice(0, 2).toUpperCase()}</span><div><strong>{account.name}</strong><small>{account.email}</small></div><button className="logout-button" onClick={handleLogout}>로그아웃</button></div></aside>
      <main className="main-content"><header className="topbar"><div><p className="eyebrow">MY VAULT / 2026.10.10</p><h1>내 물건의 현재를<br /><em>기록하는 공간</em></h1></div><div className="topbar-actions">{activeView === 'sell' && selectedProduct && <button className="secondary-button" onClick={() => { void navigator.clipboard?.writeText(`${selectedProduct.preparation.title}\n\n${selectedProduct.preparation.description}`) }}>판매글 복사</button>}<button className="primary-button" onClick={openCreate}>+ 물건 등록</button></div></header>
        {activeView === 'vault' ? <><section className="summary-strip"><div><span className="summary-label">보유 물건</span><strong>{products.length}<small>개</small></strong></div><div><span className="summary-label">현재 확인된 가치</span><strong>{formatPrice(products.reduce((sum, product) => sum + (product.currentPrice ?? 0), 0))}</strong></div><div><span className="summary-label">판매 준비 중</span><strong>{products.filter((product) => product.condition !== '정상').length}<small>개</small></strong></div></section><section className="content-section"><div className="section-heading"><div><p className="eyebrow">YOUR COLLECTION</p><h2>보유 물건</h2></div><button className="text-button" onClick={openCreate}>+ 새 물건 추가</button></div><div className="vault-toolbar"><label className="search-box"><span>⌕</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="제품명, 브랜드, 모델명 검색" aria-label="보유 물건 검색" /></label><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as '전체' | Category)} aria-label="카테고리 필터"><option value="전체">전체 카테고리</option>{Object.keys(categoryChecks).map((category) => <option key={category} value={category}>{category}</option>)}</select></div>{filteredProducts.length ? <div className="product-grid">{filteredProducts.map((product) => <ProductCard key={product.id} product={product} selected={product.id === selectedProduct?.id} onClick={() => setSelectedId(product.id)} />)}</div> : <div className="filter-empty"><strong>조건에 맞는 물건이 없어요.</strong><span>검색어나 카테고리를 바꿔보세요.</span><button className="text-button" onClick={() => { setSearchQuery(''); setCategoryFilter('전체') }}>필터 초기화</button></div>}</section>{selectedProduct && <ProductDetail product={selectedProduct} readiness={readiness} onUpdate={updateProduct} onEdit={openEdit} onDelete={deleteSelected} onGoCondition={() => setActiveView('condition')} onGoSell={() => setActiveView('sell')} onGoTrust={() => setActiveView('trust')} />}</> : activeView === 'condition' ? selectedProduct ? <ConditionLab product={selectedProduct} onUpdate={updateProduct} /> : <EmptyState onAdd={openCreate} /> : activeView === 'sell' ? selectedProduct ? <SellStudio product={selectedProduct} readiness={readiness} onUpdate={updateProduct} onGoTrust={() => setActiveView('trust')} /> : <EmptyState onAdd={openCreate} /> : selectedProduct ? <TrustSheet product={selectedProduct} onUpdate={updateProduct} /> : <EmptyState onAdd={openCreate} />}
        <footer className="app-footer"><span>SELLREADY / 물건을 관리하고, 준비하고, 보내는 일</span><span>데이터는 이 브라우저에 안전하게 저장됩니다.</span></footer></main>
      {isFormOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIsFormOpen(false)}><form key={editingId ?? 'new'} className="modal" onSubmit={handleCreate}><div className="modal-heading"><div><p className="eyebrow">{editingId ? 'EDIT ITEM' : 'ADD TO VAULT'}</p><h2>{editingId ? '물건 정보 수정' : '새 물건 등록'}</h2></div><button type="button" className="close-button" onClick={() => setIsFormOpen(false)}>닫기</button></div><div className="form-grid"><label>제품명<input name="name" required defaultValue={editingId ? selectedProduct?.name : ''} placeholder="예: WH-1000XM5" /></label><label>브랜드<input name="brand" defaultValue={editingId ? selectedProduct?.brand : ''} placeholder="예: Sony" /></label><label>모델명<input name="modelName" defaultValue={editingId ? selectedProduct?.modelName : ''} placeholder="제품 모델명" /></label><label>카테고리<select name="category" defaultValue={editingId ? selectedProduct?.category : '헤드폰'}>{Object.keys(categoryChecks).map((category) => <option key={category}>{category}</option>)}</select></label><label>구매일<input name="purchaseDate" type="date" max={todayDate} required defaultValue={editingId ? selectedProduct?.purchaseDate : '2026-01-01'} /></label><label>구매가격<input name="purchasePrice" type="number" required min="0" defaultValue={editingId ? selectedProduct?.purchasePrice : ''} placeholder="420000" /></label><label className="wide">구성품<input name="components" defaultValue={editingId ? selectedProduct?.components : ''} placeholder="본체, 케이스, 케이블" /></label><label className="wide">개인 메모<textarea name="note" rows={3} defaultValue={editingId ? selectedProduct?.note : ''} placeholder="사용감, 보관 상태 등을 기록하세요." /></label></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setIsFormOpen(false)}>취소</button><button className="primary-button" type="submit">{editingId ? '변경사항 저장' : 'Vault에 저장'}</button></div></form></div>}
    </div>
  )
}

function ProductCard({ product, selected, onClick }: { product: Product; selected: boolean; onClick: () => void }) { return <button className={selected ? 'product-card selected' : 'product-card'} onClick={onClick}><div className={`product-visual ${product.category === '헤드폰' ? 'headphone' : 'generic'}`}>{product.imageDataUrls[0] ? <img className="product-card-image" src={product.imageDataUrls[0]} alt={`${product.name} 대표 사진`} /> : <span>{product.category === '헤드폰' ? '◌' : 'BOX'}</span>}</div><div className="product-card-body"><div className="card-topline"><span className="category-tag">{product.category}</span><span className={`status-dot ${product.condition === '정상' ? 'good' : ''}`}></span></div><h3>{product.name}</h3><p>{product.brand || '브랜드 미입력'} · {getUsageDuration(product.purchaseDate)}</p><div className="card-price"><span>구매 {formatPrice(product.purchasePrice)}</span><strong>{formatPrice(product.currentPrice)}</strong></div></div></button> }

function ProductDetail({ product, readiness, onUpdate, onEdit, onDelete, onGoCondition, onGoSell, onGoTrust }: { product: Product; readiness: number; onUpdate: (product: Product) => void; onEdit: () => void; onDelete: () => void; onGoCondition: () => void; onGoSell: () => void; onGoTrust: () => void }) { const priceDifference = product.currentPrice === undefined ? undefined : product.currentPrice - product.purchasePrice; const formattedDifference = priceDifference === undefined ? '가격 확인 전' : `${priceDifference > 0 ? '+' : ''}${priceDifference.toLocaleString('ko-KR')}원`; const history = [...product.priceHistory].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)); function recordPrice(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const price = Number(form.get('price')); if (!price) return; const checkedAt = String(form.get('checkedAt')); const source = String(form.get('source') || '직접 기록'); onUpdate({ ...product, currentPrice: price, priceSource: source, priceHistory: [...product.priceHistory, { price, checkedAt, source }] }); event.currentTarget.reset() } return <section className="detail-panel"><div className="detail-intro"><div><p className="eyebrow">SELECTED ITEM / {product.category}</p><h2>{product.name}</h2><p>{product.brand || '브랜드 미입력'} · {product.modelName || '모델명 미입력'}</p></div><div className="detail-actions"><span className="condition-badge">{product.condition}</span><button className="text-button" onClick={onEdit}>편집</button><button className="danger-button" onClick={onDelete}>삭제</button></div></div><div className="detail-grid"><div className="metric-block"><span>현재 신품가격</span><strong>{formatPrice(product.currentPrice)}</strong><small>{product.priceSource ?? '아직 가격을 확인하지 않았어요.'}</small></div><div className="metric-block"><span>구매가격 대비</span><strong className={priceDifference && priceDifference < 0 ? 'loss' : ''}>{formattedDifference}</strong><small>구매일 {product.purchaseDate}</small></div><div className="metric-block"><span>사용기간</span><strong>{getUsageDuration(product.purchaseDate)}</strong><small>오늘 기준 자동 계산</small></div><div className="metric-block readiness"><span>판매 준비도</span><strong>{readiness}%</strong><div className="progress-track"><i style={{ width: `${readiness}%` }} /></div></div></div><div className="detail-lower"><div><span className="subheading">CONDITION SNAPSHOT</span><p className="note">{product.note || '아직 기록된 메모가 없습니다.'}</p><p className="components">구성품 · {product.components || '미입력'}</p></div><div className="detail-actions"><button className="secondary-button" onClick={onGoCondition}>상태 점검하기 →</button><button className="primary-button" onClick={onGoSell}>판매 준비하기 →</button><button className="secondary-button" onClick={onGoTrust}>Trust Sheet →</button></div></div><div className="price-history"><div className="history-heading"><div><span className="subheading">PRICE HISTORY</span><h3>가격 기록</h3></div><span>{history.length}회 확인</span></div>{history.length ? <div className="history-list">{history.map((snapshot) => <div className="history-row" key={`${snapshot.checkedAt}-${snapshot.price}`}><span>{snapshot.checkedAt}</span><strong>{formatPrice(snapshot.price)}</strong><small>{snapshot.source}</small></div>)}</div> : <p className="history-empty">아직 기록이 없습니다. 아래에서 현재 가격을 기록해보세요.</p>}<form className="price-form" onSubmit={recordPrice}><input name="price" type="number" min="1" required placeholder="현재 가격" aria-label="현재 신품가격" /><input name="checkedAt" type="date" required defaultValue={todayDate} aria-label="가격 확인일" /><input name="source" placeholder="출처 (예: 공식몰)" aria-label="가격 출처" /><button className="secondary-button">가격 기록</button></form></div></section> }

function SellStudio({ product, readiness, onUpdate, onGoTrust }: { product: Product; readiness: number; onUpdate: (product: Product) => void; onGoTrust: () => void }) { const guides = photoGuides[product.category]; const listing = buildListing(product); const preparation = product.preparation.title ? product.preparation : { ...product.preparation, title: listing.title, description: listing.description }; function togglePhoto(guide: string) { onUpdate({ ...product, preparation: { ...preparation, photos: { ...preparation.photos, [guide]: !preparation.photos[guide] } } }) } function saveListing(field: 'title' | 'description', value: string) { onUpdate({ ...product, preparation: { ...preparation, [field]: value } }) } function uploadImages(event: ChangeEvent<HTMLInputElement>) { const files = Array.from(event.target.files ?? []).slice(0, 6 - product.imageDataUrls.length); files.forEach((file) => { if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) return; const reader = new FileReader(); reader.onload = () => { const result = reader.result; if (typeof result === 'string') onUpdate({ ...product, imageDataUrls: [...product.imageDataUrls, result] }) }; reader.readAsDataURL(file) }); event.target.value = '' } function removeImage(index: number) { onUpdate({ ...product, imageDataUrls: product.imageDataUrls.filter((_, imageIndex) => imageIndex !== index) }) } return <section className="content-section studio-page"><div className="section-heading"><div><p className="eyebrow">SELL STUDIO / {product.name}</p><h2>판매할 준비를 시작해요</h2><p className="section-description">Condition Lab에서 기록한 정보가 사진 가이드와 판매글 초안에 연결됩니다.</p></div><div className="studio-score"><strong>{readiness}%</strong><span>SELL READY</span></div></div><div className="studio-layout"><div className="studio-guide"><div className="studio-card-heading"><div><span className="subheading">PHOTO GUIDE</span><h3>필요한 사진</h3></div><span>{Object.values(preparation.photos).filter(Boolean).length} / {guides.length}</span></div><div className="guide-list">{guides.map((guide) => <label className={preparation.photos[guide] ? 'guide-item done' : 'guide-item'} key={guide}><input type="checkbox" checked={Boolean(preparation.photos[guide])} onChange={() => togglePhoto(guide)} /><span className="guide-check">{preparation.photos[guide] ? '✓' : ''}</span><span>{guide}</span></label>)}{Object.entries(product.checks).filter(([, status]) => status === '사용감 있음' || status === '문제 있음').map(([item]) => <div className="guide-callout" key={item}>추가 사진 필요 · {item}의 상태가 잘 보이는 사진을 촬영해주세요.</div>)}</div><div className="image-upload"><label className="upload-button">+ 사진 추가<input type="file" accept="image/*" multiple onChange={uploadImages} /></label><small>최대 6장 · 이미지 1장당 2MB 이하</small><div className="image-grid">{product.imageDataUrls.map((image, index) => <div className="image-thumb" key={`${image.slice(0, 20)}-${index}`}><img src={image} alt={`업로드한 제품 사진 ${index + 1}`} /><button type="button" onClick={() => removeImage(index)}>삭제</button></div>)}</div></div></div><div className="studio-copy"><div className="studio-card-heading"><div><span className="subheading">LISTING DRAFT</span><h3>판매글 초안</h3></div><span>직접 확인 필요</span></div><label>판매 제목<input value={preparation.title} onChange={(event) => saveListing('title', event.target.value)} /></label><label>판매 설명<textarea rows={8} value={preparation.description} onChange={(event) => saveListing('description', event.target.value)} /></label><p className="studio-note">확인되지 않은 기능이나 상태는 포함하지 않았습니다. 게시 전 내용을 꼭 검토해주세요.</p><button className="primary-button" onClick={onGoTrust}>Trust Sheet 만들기 →</button></div></div></section> }

function TrustSheet({ product, onUpdate }: { product: Product; onUpdate: (product: Product) => void }) { const fieldOptions: { key: TrustField; label: string }[] = [{ key: 'identity', label: '제품명과 모델명' }, { key: 'usage', label: '사용기간' }, { key: 'condition', label: '기능 확인결과와 외관상태' }, { key: 'components', label: '구성품' }, { key: 'issues', label: '판매자가 공개한 하자' }, { key: 'checkedAt', label: '최근 자가점검 날짜' }, { key: 'photos', label: '제품 사진' }]; const sheet = product.trustSheet; const toggleField = (field: TrustField) => { const fields = sheet.publishedFields.includes(field) ? sheet.publishedFields.filter((item) => item !== field) : [...sheet.publishedFields, field]; onUpdate({ ...product, trustSheet: { ...sheet, publishedFields: fields } }) }; const publish = () => onUpdate({ ...product, trustSheet: { ...sheet, isActive: true, checkedAt: todayDate } }); const deactivate = () => onUpdate({ ...product, trustSheet: { ...sheet, isActive: false } }); const issues = Object.entries(product.checks).filter(([, status]) => status === '사용감 있음' || status === '문제 있음'); return <section className="content-section trust-page"><div className="section-heading"><div><p className="eyebrow">TRUST SHEET / {product.name}</p><h2>보여줄 정보만 선택해요</h2><p className="section-description">구매가격, 신품가격, 가격 이력, 개인 메모는 공개 목록에 포함되지 않습니다.</p></div><span className={sheet.isActive ? 'published-badge' : 'private-badge'}>{sheet.isActive ? 'PUBLIC' : 'PRIVATE'}</span></div><div className="trust-layout"><div className="trust-settings"><span className="subheading">PUBLIC FIELDS</span><h3>공개할 정보</h3><div className="trust-options">{fieldOptions.map((field) => <label className="trust-option" key={field.key}><input type="checkbox" checked={sheet.publishedFields.includes(field.key)} onChange={() => toggleField(field.key)} /><span>{field.label}</span></label>)}</div><div className="trust-actions"><button className="primary-button" onClick={publish}>Trust Sheet 공개</button>{sheet.isActive && <button className="secondary-button" onClick={deactivate}>공개 비활성화</button>}</div><p className="trust-link">{sheet.isActive ? `공유 링크: /trust/${sheet.publicToken}` : '아직 공개되지 않은 비공개 초안입니다.'}</p></div><div className="trust-preview"><div className="preview-label">SELLREADY TRUST SHEET <span>{sheet.isActive ? '공개 중' : '미리보기'}</span></div>{sheet.publishedFields.includes('identity') && <><h3>{product.brand ? `${product.brand} ` : ''}{product.name}</h3><p className="preview-model">{product.modelName || '모델명 미입력'} · {product.category}</p></>}{sheet.publishedFields.includes('photos') && product.imageDataUrls.length > 0 && <div className="preview-images">{product.imageDataUrls.map((image, index) => <img key={`${image.slice(0, 20)}-${index}`} src={image} alt={`공개 제품 사진 ${index + 1}`} />)}</div>}{sheet.publishedFields.includes('usage') && <div className="preview-row"><span>사용기간</span><strong>{getUsageDuration(product.purchaseDate)}</strong></div>}{sheet.publishedFields.includes('condition') && <div className="preview-block"><span>기능 확인 및 외관상태</span><p>{Object.entries(product.checks).filter(([, status]) => status === '정상').map(([item]) => `✓ ${item}`).join('  ') || '확인된 기능이 없습니다.'}</p><small>외관 · {product.condition}</small></div>}{sheet.publishedFields.includes('components') && <div className="preview-block"><span>구성품</span><p>{product.components || '미입력'}</p></div>}{sheet.publishedFields.includes('issues') && <div className="preview-block issue"><span>판매자 공개사항</span><p>{issues.length ? issues.map(([item, status]) => `${item} ${status}`).join(', ') : '특이사항 없음'}</p></div>}{sheet.publishedFields.includes('checkedAt') && <div className="preview-row"><span>최근 자가점검</span><strong>{sheet.checkedAt || '공개 시 기록됩니다.'}</strong></div>}<p className="trust-disclaimer">본 정보는 판매자가 직접 입력·확인한 정보이며 SellReady의 전문 검수 또는 제품 품질보증을 의미하지 않습니다.</p></div></div></section> }

function PublicTrustSheet({ product }: { product?: Product }) { if (!product) return <div className="public-trust-shell"><div className="public-trust-card"><span className="brand-mark">S</span><h1>Trust Sheet를 찾을 수 없습니다</h1><p>링크가 만료되었거나 판매자가 공개를 중지했어요.</p></div></div>; const sheet = product.trustSheet; const issues = Object.entries(product.checks).filter(([, status]) => status === '사용감 있음' || status === '문제 있음'); return <div className="public-trust-shell"><article className="public-trust-card"><div className="preview-label">SELLREADY TRUST SHEET <span>PUBLIC</span></div>{sheet.publishedFields.includes('identity') && <><h1>{product.brand ? `${product.brand} ` : ''}{product.name}</h1><p className="preview-model">{product.modelName || '모델명 미입력'} · {product.category}</p></>}{sheet.publishedFields.includes('photos') && product.imageDataUrls.length > 0 && <div className="preview-images">{product.imageDataUrls.map((image, index) => <img key={`${image.slice(0, 20)}-${index}`} src={image} alt={`제품 사진 ${index + 1}`} />)}</div>}{sheet.publishedFields.includes('usage') && <div className="preview-row"><span>사용기간</span><strong>{getUsageDuration(product.purchaseDate)}</strong></div>}{sheet.publishedFields.includes('condition') && <div className="preview-block"><span>기능 확인 및 외관상태</span><p>{Object.entries(product.checks).filter(([, status]) => status === '정상').map(([item]) => `✓ ${item}`).join('  ') || '확인된 기능이 없습니다.'}</p><small>외관 · {product.condition}</small></div>}{sheet.publishedFields.includes('components') && <div className="preview-block"><span>구성품</span><p>{product.components || '미입력'}</p></div>}{sheet.publishedFields.includes('issues') && <div className="preview-block issue"><span>판매자 공개사항</span><p>{issues.length ? issues.map(([item, status]) => `${item} ${status}`).join(', ') : '특이사항 없음'}</p></div>}{sheet.publishedFields.includes('checkedAt') && <div className="preview-row"><span>최근 자가점검</span><strong>{sheet.checkedAt || '확인되지 않음'}</strong></div>}<p className="trust-disclaimer">본 정보는 판매자가 직접 입력·확인한 정보이며 SellReady의 전문 검수 또는 제품 품질보증을 의미하지 않습니다.</p></article></div> }

function AuthView({ onLogin }: { onLogin: (account: Account) => void }) { function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); onLogin({ name: String(form.get('name')).trim(), email: String(form.get('email')).trim().toLowerCase() }) } return <div className="auth-shell"><div className="auth-panel"><div className="brand auth-brand"><span className="brand-mark">S</span><span>SellReady</span></div><p className="eyebrow">PRIVATE OBJECT ARCHIVE</p><h1>내 물건의 현재를<br /><em>기록하는 공간</em></h1><p className="auth-copy">물건을 등록하고, 현재 가치를 확인하고,<br />판매를 결정하는 순간까지 준비해보세요.</p><form className="auth-form" onSubmit={submit}><label>이름<input name="name" required placeholder="이름을 입력하세요" /></label><label>이메일<input name="email" type="email" required placeholder="you@example.com" /></label><button className="primary-button" type="submit">내 Vault 시작하기</button></form><p className="prototype-note">현재는 프로토타입 단계입니다. 계정 정보와 물건 데이터는 이 브라우저에만 저장됩니다.</p></div></div> }

function ConditionLab({ product, onUpdate }: { product: Product; onUpdate: (product: Product) => void }) { const checks = categoryChecks[product.category]; function updateCheck(check: string, status: ConditionStatus) { const checksNext = { ...product.checks, [check]: status }; onUpdate({ ...product, checks: checksNext, condition: Object.values(checksNext).some((value) => value === '문제 있음') ? '문제 있음' : Object.values(checksNext).some((value) => value === '사용감 있음') ? '사용감 있음' : '정상' }) } function updateNote(check: string, note: string) { onUpdate({ ...product, checkNotes: { ...product.checkNotes, [check]: note } }) } function addEvidence(check: string, event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file || !file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) return; const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === 'string') onUpdate({ ...product, checkImages: { ...product.checkImages, [check]: [...(product.checkImages[check] ?? []), reader.result] } }) }; reader.readAsDataURL(file); event.target.value = '' } return <section className="content-section condition-page"><div className="section-heading"><div><p className="eyebrow">CONDITION LAB / {product.name}</p><h2>상태를 하나씩 확인해요</h2><p className="section-description">직접 확인한 내용만 기록됩니다. 이 정보는 판매 준비와 Trust Sheet에 연결됩니다.</p></div><span className="lab-score">{Object.values(product.checks).filter((status) => status !== '확인 필요').length} / {checks.length}</span></div><div className="checklist">{checks.map((check) => <div className="check-row evidence-row" key={check}><div className="check-main"><strong>{check}</strong><small>{product.checks[check] === '확인 필요' ? '아직 확인하지 않았어요' : '확인 완료'}</small><input value={product.checkNotes[check] ?? ''} onChange={(event) => updateNote(check, event.target.value)} placeholder="메모를 남겨보세요" aria-label={`${check} 메모`} /><label className="evidence-upload">사진 추가<input type="file" accept="image/*" onChange={(event) => addEvidence(check, event)} /></label></div><select value={product.checks[check]} onChange={(event) => updateCheck(check, event.target.value as ConditionStatus)}><option>확인 필요</option><option>정상</option><option>사용감 있음</option><option>문제 있음</option></select></div>)}</div></section> }

function EmptyState({ onAdd }: { onAdd: () => void }) { return <section className="empty-state"><span className="empty-mark">+</span><h2>아직 등록한 물건이 없어요</h2><p>가지고 있는 물건을 기록하면 현재 가치와 상태를 한눈에 관리할 수 있어요.</p><button className="primary-button" onClick={onAdd}>첫 물건 등록하기</button></section> }

export default App
