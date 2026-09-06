param([int]$Port=8766)

$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem
$script:Prefix="http://127.0.0.1:$Port/"
$script:CacheRoot=Join-Path $PSScriptRoot 'piece-cutting-cache'
$script:TempPrefix='piece-cutting-pdf-'
$script:MaxRequestBytes=190MB
$script:CorsOrigin=''
[System.IO.Directory]::CreateDirectory($script:CacheRoot)|Out-Null

function Test-AllowedOrigin([string]$Origin){
  if([string]::IsNullOrWhiteSpace($Origin)){return $true}
  if($Origin -eq 'https://wenhsiang-arch.github.io'){return $true}
  return $Origin -match '^http://(127\.0\.0\.1|localhost)(:\d+)?$'
}

function Set-ResponseHeaders($Response){
  $Response.Headers['Access-Control-Allow-Methods']='GET, POST, DELETE, OPTIONS'
  $Response.Headers['Access-Control-Allow-Headers']='Content-Type'
  $Response.Headers['Cache-Control']='no-store'
  if($script:CorsOrigin){$Response.Headers['Access-Control-Allow-Origin']=$script:CorsOrigin;$Response.Headers['Vary']='Origin'}
}

function Send-Bytes($Response,[int]$Status,[byte[]]$Bytes,[string]$ContentType){
  Set-ResponseHeaders $Response;$Response.StatusCode=$Status;$Response.ContentType=$ContentType;$Response.ContentLength64=$Bytes.Length
  if($Bytes.Length){$Response.OutputStream.Write($Bytes,0,$Bytes.Length)};$Response.Close()
}

function Send-Text($Response,[int]$Status,[string]$Text){Send-Bytes $Response $Status ([Text.Encoding]::UTF8.GetBytes($Text)) 'application/json; charset=utf-8'}
function Send-Json($Response,[int]$Status,$Value){Send-Text $Response $Status ($Value|ConvertTo-Json -Depth 12 -Compress)}

function Read-Json($Request){
  if($Request.ContentLength64 -gt $script:MaxRequestBytes){throw 'REQUEST_TOO_LARGE / 要求內容超過上限'}
  $reader=[IO.StreamReader]::new($Request.InputStream,$Request.ContentEncoding)
  try{$raw=$reader.ReadToEnd()}finally{$reader.Dispose()}
  if([Text.Encoding]::UTF8.GetByteCount($raw) -gt $script:MaxRequestBytes){throw 'REQUEST_TOO_LARGE / 要求內容超過上限'}
  if([string]::IsNullOrWhiteSpace($raw)){return [pscustomobject]@{}}
  return $raw|ConvertFrom-Json
}

function Get-SafeHash($Template){
  $hash=([string]$Template.contentHash).Trim().ToLowerInvariant()
  if($hash -notmatch '^[0-9a-f]{64}$'){throw 'INVALID_TEMPLATE_HASH / 主檔內容驗證碼無效'}
  return $hash
}

function Get-CacheDir($Template){Join-Path $script:CacheRoot (Get-SafeHash $Template)}
function Get-CacheIndex($Template){Join-Path (Get-CacheDir $Template) 'index.json'}

function Resolve-ZipTarget([string]$Source,[string]$Target){
  if($Target.StartsWith('/')){return $Target.TrimStart('/')}
  $base=$Source.Replace('\','/');$slash=$base.LastIndexOf('/');$dir=if($slash-ge 0){$base.Substring(0,$slash)}else{''}
  $parts=New-Object Collections.Generic.List[string]
  foreach($part in (($dir+'/'+$Target.Replace('\','/'))-split '/')){
    if(-not $part-or$part-eq'.'){continue};if($part-eq'..'){if($parts.Count){$parts.RemoveAt($parts.Count-1)}}else{$parts.Add($part)}
  }
  return $parts-join '/'
}

function Get-RelationshipMap([string]$Path){
  $map=@{};if(-not(Test-Path -LiteralPath $Path)){return $map}
  [xml]$xml=Get-Content -LiteralPath $Path -Raw
  foreach($relation in @($xml.Relationships.Relationship)){$map[[string]$relation.Id]=[string]$relation.Target}
  return $map
}

function Get-XmlNumber($Node,[string]$Name,[double]$Default=0){
  if($null-eq$Node){return $Default};$raw=[string]$Node.GetAttribute($Name);if([string]::IsNullOrWhiteSpace($raw)){return $Default}
  try{return [Convert]::ToDouble($raw,[Globalization.CultureInfo]::InvariantCulture)}catch{return $Default}
}

function Get-ImageHash([string]$Path){
  $sha=[Security.Cryptography.SHA256]::Create()
  try{$stream=[IO.File]::OpenRead($Path);try{return ([BitConverter]::ToString($sha.ComputeHash($stream))-replace'-','').ToLowerInvariant()}finally{$stream.Dispose()}}finally{$sha.Dispose()}
}

function Save-DisplayedTemplateImage([string]$Source,[string]$Target,[double]$RotationDegrees,[double]$CropLeft,[double]$CropTop,[double]$CropRight,[double]$CropBottom){
  $sourceImage=[Drawing.Image]::FromFile($Source);$cropped=$null;$display=$null
  try{
    $cropValues=@($CropLeft,$CropTop,$CropRight,$CropBottom)|ForEach-Object{[Math]::Max(0,[Math]::Min(99999,[double]$_))}
    $left=[int][Math]::Round($sourceImage.Width*$cropValues[0]/100000.0);$top=[int][Math]::Round($sourceImage.Height*$cropValues[1]/100000.0)
    $right=[int][Math]::Round($sourceImage.Width*$cropValues[2]/100000.0);$bottom=[int][Math]::Round($sourceImage.Height*$cropValues[3]/100000.0)
    $cropWidth=$sourceImage.Width-$left-$right;$cropHeight=$sourceImage.Height-$top-$bottom
    if($cropWidth-lt 1-or$cropHeight-lt 1){throw 'INVALID_IMAGE_CROP / 圖片裁切範圍無效'}
    $cropped=[Drawing.Bitmap]::new($cropWidth,$cropHeight,[Drawing.Imaging.PixelFormat]::Format24bppRgb);$cropGraphics=[Drawing.Graphics]::FromImage($cropped)
    try{$cropGraphics.Clear([Drawing.Color]::White);$cropGraphics.InterpolationMode='HighQualityBicubic';$cropGraphics.PixelOffsetMode='HighQuality';$cropGraphics.DrawImage($sourceImage,[Drawing.Rectangle]::new(0,0,$cropWidth,$cropHeight),[Drawing.Rectangle]::new($left,$top,$cropWidth,$cropHeight),[Drawing.GraphicsUnit]::Pixel)}finally{$cropGraphics.Dispose()}
    $angle=(([double]$RotationDegrees%360)+360)%360
    if([Math]::Abs($angle)-lt 0.001){$display=$cropped;$cropped=$null}
    elseif([Math]::Abs($angle-90)-lt 0.001){$cropped.RotateFlip([Drawing.RotateFlipType]::Rotate90FlipNone);$display=$cropped;$cropped=$null}
    elseif([Math]::Abs($angle-180)-lt 0.001){$cropped.RotateFlip([Drawing.RotateFlipType]::Rotate180FlipNone);$display=$cropped;$cropped=$null}
    elseif([Math]::Abs($angle-270)-lt 0.001){$cropped.RotateFlip([Drawing.RotateFlipType]::Rotate270FlipNone);$display=$cropped;$cropped=$null}
    else{
      $radians=$angle*[Math]::PI/180.0;$displayWidth=[int][Math]::Ceiling([Math]::Abs($cropWidth*[Math]::Cos($radians))+[Math]::Abs($cropHeight*[Math]::Sin($radians)));$displayHeight=[int][Math]::Ceiling([Math]::Abs($cropWidth*[Math]::Sin($radians))+[Math]::Abs($cropHeight*[Math]::Cos($radians)))
      $display=[Drawing.Bitmap]::new($displayWidth,$displayHeight,[Drawing.Imaging.PixelFormat]::Format24bppRgb);$rotationGraphics=[Drawing.Graphics]::FromImage($display)
      try{$rotationGraphics.Clear([Drawing.Color]::White);$rotationGraphics.InterpolationMode='HighQualityBicubic';$rotationGraphics.TranslateTransform($displayWidth/2.0,$displayHeight/2.0);$rotationGraphics.RotateTransform([single]$angle);$rotationGraphics.TranslateTransform(-$cropWidth/2.0,-$cropHeight/2.0);$rotationGraphics.DrawImage($cropped,0,0,$cropWidth,$cropHeight)}finally{$rotationGraphics.Dispose()}
    }
    $codec=[Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|Where-Object{$_.MimeType-eq'image/jpeg'}|Select-Object -First 1;$parameters=[Drawing.Imaging.EncoderParameters]::new(1);$parameters.Param[0]=[Drawing.Imaging.EncoderParameter]::new([Drawing.Imaging.Encoder]::Quality,[long]92)
    try{$display.Save($Target,$codec,$parameters)}finally{$parameters.Dispose()}
    return [pscustomobject]@{path=$Target;hash=(Get-ImageHash $Target);width=$display.Width;height=$display.Height;rotationDegrees=$angle;crop=[pscustomobject]@{left=$cropValues[0];top=$cropValues[1];right=$cropValues[2];bottom=$cropValues[3]}}
  }finally{if($null-ne$display){$display.Dispose()};if($null-ne$cropped){$cropped.Dispose()};$sourceImage.Dispose()}
}

function Get-WorkbookSheets([string]$ExtractRoot){
  $workbookPart='xl/workbook.xml';$workbookPath=Join-Path $ExtractRoot $workbookPart
  $relationsPath=Join-Path $ExtractRoot 'xl\_rels\workbook.xml.rels'
  if(-not(Test-Path -LiteralPath $workbookPath)-or-not(Test-Path -LiteralPath $relationsPath)){return @()}
  [xml]$workbook=Get-Content -LiteralPath $workbookPath -Raw
  $manager=[Xml.XmlNamespaceManager]::new($workbook.NameTable);$manager.AddNamespace('s','http://schemas.openxmlformats.org/spreadsheetml/2006/main');$manager.AddNamespace('r','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $relations=Get-RelationshipMap $relationsPath;$result=@();$sheetIndex=0
  foreach($sheet in @($workbook.SelectNodes('//s:sheets/s:sheet',$manager))){
    $sheetIndex++;$rid=[string]$sheet.GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    if(-not$relations.ContainsKey($rid)){continue}
    $part=Resolve-ZipTarget $workbookPart $relations[$rid]
    $result+=[pscustomobject]@{sheetIndex=$sheetIndex;sheetName=[string]$sheet.GetAttribute('name');part=$part}
  }
  return @($result)
}

function Get-TemplateImages([string]$ExtractRoot,[string]$CacheDir){
  $imageDir=Join-Path $CacheDir 'images';[IO.Directory]::CreateDirectory($imageDir)|Out-Null;$result=@();$index=0
  foreach($sheetInfo in @(Get-WorkbookSheets $ExtractRoot)){
    $sheetPath=Join-Path $ExtractRoot $sheetInfo.part;if(-not(Test-Path -LiteralPath $sheetPath)){continue}
    [xml]$sheet=Get-Content -LiteralPath $sheetPath -Raw
    $manager=[Xml.XmlNamespaceManager]::new($sheet.NameTable);$manager.AddNamespace('s','http://schemas.openxmlformats.org/spreadsheetml/2006/main');$manager.AddNamespace('r','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $drawing=$sheet.SelectSingleNode('//s:drawing',$manager);if($null-eq$drawing){continue}
    $rid=[string]$drawing.GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $sheetDirectory=[IO.Path]::GetDirectoryName([string]$sheetInfo.part).Replace('\','/');$sheetFile=[IO.Path]::GetFileName([string]$sheetInfo.part)
    $sheetRelPart=$sheetDirectory+'/_rels/'+$sheetFile+'.rels';$sheetRels=Get-RelationshipMap (Join-Path $ExtractRoot $sheetRelPart)
    if(-not$sheetRels.ContainsKey($rid)){continue}
    $drawingPart=Resolve-ZipTarget ([string]$sheetInfo.part) $sheetRels[$rid]
    $drawingPath=Join-Path $ExtractRoot $drawingPart;if(-not(Test-Path -LiteralPath $drawingPath)){continue}
    $drawingRelPart=([IO.Path]::GetDirectoryName($drawingPart).Replace('\','/'))+'/_rels/'+[IO.Path]::GetFileName($drawingPart)+'.rels'
    $drawingRels=Get-RelationshipMap (Join-Path $ExtractRoot $drawingRelPart)
    [xml]$drawingXml=Get-Content -LiteralPath $drawingPath -Raw
    $dm=[Xml.XmlNamespaceManager]::new($drawingXml.NameTable);$dm.AddNamespace('xdr','http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing');$dm.AddNamespace('a','http://schemas.openxmlformats.org/drawingml/2006/main');$dm.AddNamespace('r','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    foreach($anchor in @($drawingXml.SelectNodes('//xdr:twoCellAnchor|//xdr:oneCellAnchor',$dm))){
      $blip=$anchor.SelectSingleNode('.//a:blip',$dm);if($null-eq$blip){continue};$embed=[string]$blip.GetAttribute('embed','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
      if(-not$drawingRels.ContainsKey($embed)){continue};$mediaPart=Resolve-ZipTarget $drawingPart $drawingRels[$embed];$source=Join-Path $ExtractRoot $mediaPart
      if(-not(Test-Path -LiteralPath $source)){continue};$extension=[IO.Path]::GetExtension($source).ToLowerInvariant();if($extension-notin @('.jpg','.jpeg','.png','.bmp','.gif')){continue}
      $xfrm=$anchor.SelectSingleNode('.//xdr:pic/xdr:spPr/a:xfrm',$dm);$srcRect=$anchor.SelectSingleNode('.//xdr:pic/xdr:blipFill/a:srcRect',$dm)
      $rotationDegrees=(Get-XmlNumber $xfrm 'rot' 0)/60000.0;$cropLeft=Get-XmlNumber $srcRect 'l' 0;$cropTop=Get-XmlNumber $srcRect 't' 0;$cropRight=Get-XmlNumber $srcRect 'r' 0;$cropBottom=Get-XmlNumber $srcRect 'b' 0
      $index++;$target=Join-Path $imageDir ("image_{0:000}.jpg"-f$index);$displayImage=Save-DisplayedTemplateImage $source $target $rotationDegrees $cropLeft $cropTop $cropRight $cropBottom
      $rowNode=$anchor.SelectSingleNode('./xdr:from/xdr:row',$dm);$row=if($null-ne$rowNode){[int]$rowNode.InnerText+1}else{1}
      $result+=[pscustomobject]@{sheetIndex=[int]$sheetInfo.sheetIndex;sheetName=[string]$sheetInfo.sheetName;row=$row;path=$displayImage.path;hash=$displayImage.hash;width=$displayImage.width;height=$displayImage.height;rotationDegrees=$displayImage.rotationDegrees;crop=$displayImage.crop}
    }
  }
  return @($result)
}

function Build-TemplateCache($Template){
  $hash=Get-SafeHash $Template;$cacheDir=Get-CacheDir $Template;$indexPath=Get-CacheIndex $Template
  if(Test-Path -LiteralPath $indexPath){
    try{$existing=Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8|ConvertFrom-Json;if([int]$existing.version-eq 3-and[string]$existing.contentHash-eq$hash-and[long]$existing.fileSize-eq[long]$Template.fileSize){return $existing}}catch{}
  }
  if(-not$Template.base64){throw 'TEMPLATE_CACHE_MISS / 本機沒有裁片主檔快取'}
  if(Test-Path -LiteralPath $cacheDir){Remove-Item -LiteralPath $cacheDir -Recurse -Force};[IO.Directory]::CreateDirectory($cacheDir)|Out-Null
  $templatePath=Join-Path $cacheDir 'template.xlsx';[IO.File]::WriteAllBytes($templatePath,[Convert]::FromBase64String([string]$Template.base64))
  if([long]$Template.fileSize-ne(Get-Item -LiteralPath $templatePath).Length){throw 'TEMPLATE_SIZE_MISMATCH / 主檔大小不一致'}
  $extractRoot=Join-Path $cacheDir 'openxml';[IO.Compression.ZipFile]::ExtractToDirectory($templatePath,$extractRoot)
  $images=@(Get-TemplateImages $extractRoot $cacheDir);Remove-Item -LiteralPath $extractRoot -Recurse -Force
  $value=[pscustomobject]@{version=3;contentHash=$hash;fileSize=[long]$Template.fileSize;fileName=[string]$Template.fileName;images=$images;createdAt=(Get-Date).ToString('o')}
  $value|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $indexPath -Encoding UTF8;return $value
}

function Get-CacheStatus($Template){
  try{$path=Get-CacheIndex $Template;if(-not(Test-Path -LiteralPath $path)){return @{ok=$true;cached=$false}};$index=Get-Content -LiteralPath $path -Raw -Encoding UTF8|ConvertFrom-Json
    return @{ok=$true;cached=([int]$index.version-eq 3-and[string]$index.contentHash-eq(Get-SafeHash $Template)-and[long]$index.fileSize-eq[long]$Template.fileSize)}}catch{return @{ok=$true;cached=$false}}
}

function Clear-Cache(){
  $resolved=[IO.Path]::GetFullPath($script:CacheRoot);$root=[IO.Path]::GetFullPath($PSScriptRoot)
  if(-not$resolved.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'INVALID_CACHE_PATH'}
  if(Test-Path -LiteralPath $resolved){Get-ChildItem -LiteralPath $resolved -Force|Remove-Item -Recurse -Force};return @{ok=$true}
}

function New-Font([float]$Size,[Drawing.FontStyle]$Style=[Drawing.FontStyle]::Regular){return [Drawing.Font]::new('Arial',$Size,$Style,[Drawing.GraphicsUnit]::Pixel)}
function New-Brush([string]$Html){return [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($Html))}

function Draw-BoxText($Graphics,[string]$Text,[Drawing.Font]$Font,[Drawing.Brush]$Brush,[Drawing.RectangleF]$Rect,[string]$Align='Near',[string]$VAlign='Center'){
  $format=[Drawing.StringFormat]::new();$format.Alignment=[Drawing.StringAlignment]::$Align;$format.LineAlignment=[Drawing.StringAlignment]::$VAlign;$format.Trimming=[Drawing.StringTrimming]::EllipsisWord;$format.FormatFlags=[Drawing.StringFormatFlags]::LineLimit
  try{$Graphics.DrawString($Text,$Font,$Brush,$Rect,$format)}finally{$format.Dispose()}
}

function Draw-Cell($Graphics,[Drawing.Pen]$Pen,[Drawing.Brush]$Fill,[Drawing.RectangleF]$Rect,[string]$Text,[Drawing.Font]$Font,[Drawing.Brush]$TextBrush,[string]$Align='Center'){
  $Graphics.FillRectangle($Fill,$Rect);$Graphics.DrawRectangle($Pen,$Rect.X,$Rect.Y,$Rect.Width,$Rect.Height);$inner=[Drawing.RectangleF]::new($Rect.X+8,$Rect.Y+5,$Rect.Width-16,$Rect.Height-10)
  Draw-BoxText $Graphics $Text $Font $TextBrush $inner $Align 'Center'
}

function Measure-WrappedHeight($Graphics,[string]$Text,[Drawing.Font]$Font,[float]$Width,[float]$Minimum=0){
  if([string]::IsNullOrWhiteSpace($Text)){return [float]$Minimum}
  $size=$Graphics.MeasureString($Text,$Font,[int][Math]::Max(1,[Math]::Floor($Width)))
  return [float][Math]::Max($Minimum,[Math]::Ceiling($size.Height)+12)
}

function Draw-SingleLineFitted($Graphics,[string]$Text,$Fonts,[Drawing.Brush]$Brush,[Drawing.RectangleF]$Rect,[string]$Align='Center'){
  $list=@($Fonts);if(-not$list.Count){return};$selected=$list[$list.Count-1]
  foreach($font in $list){if($Graphics.MeasureString($Text,$font).Width-le$Rect.Width-12){$selected=$font;break}}
  $format=[Drawing.StringFormat]::new();$format.Alignment=[Drawing.StringAlignment]::$Align;$format.LineAlignment=[Drawing.StringAlignment]::Center;$format.FormatFlags=[Drawing.StringFormatFlags]::NoWrap;$format.Trimming=[Drawing.StringTrimming]::None
  try{$Graphics.DrawString($Text,$selected,$Brush,$Rect,$format)}finally{$format.Dispose()}
}

function Draw-WrappedTextFitted($Graphics,[string]$Text,$Fonts,[Drawing.Brush]$Brush,[Drawing.RectangleF]$Rect,[string]$Align='Center'){
  $list=@($Fonts);if(-not$list.Count){return};$selected=$list[$list.Count-1]
  foreach($font in $list){if((Measure-WrappedHeight $Graphics $Text $font ($Rect.Width-12) 0)-le$Rect.Height){$selected=$font;break}}
  Draw-BoxText $Graphics $Text $selected $Brush $Rect $Align 'Center'
}

function Draw-ItemListFitted($Graphics,$Items,$Fonts,[Drawing.Brush]$Brush,[Drawing.RectangleF]$Rect){
  $list=@($Fonts);if(-not$list.Count){return};$selected=$list[$list.Count-1];$selectedText=(@($Items)-join', ')
  foreach($font in $list){$lines=[Collections.Generic.List[string]]::new();$current='';foreach($item in @($Items)){$value=[string]$item;$candidate=if($current){$current+', '+$value}else{$value};if($current-and$Graphics.MeasureString($candidate,$font).Width-gt$Rect.Width-12){$lines.Add($current);$current=$value}else{$current=$candidate}};if($current){$lines.Add($current)};$selected=$font;$selectedText=$lines-join"`n";if((Measure-WrappedHeight $Graphics $selectedText $font ($Rect.Width-12) 0)-le$Rect.Height){break}}
  $format=[Drawing.StringFormat]::new();$format.Alignment=[Drawing.StringAlignment]::Center;$format.LineAlignment=[Drawing.StringAlignment]::Center;$format.Trimming=[Drawing.StringTrimming]::EllipsisCharacter;$format.FormatFlags=[Drawing.StringFormatFlags]::NoWrap
  try{$Graphics.DrawString($selectedText,$selected,$Brush,$Rect,$format)}finally{$format.Dispose()}
}

function Split-Items($Values,[int]$Size){
  $result=@();$items=@($Values);for($start=0;$start-lt$items.Count;$start+=$Size){$end=[Math]::Min($items.Count-1,$start+$Size-1);$result+=,@($items[$start..$end])};return @($result)
}

function Normalize-Key([string]$Value){return(([regex]::Replace(([string]$Value).Trim(),'\s+',' ')).ToUpperInvariant())}
function Get-Quantity($Part,[string]$Size){$key=Normalize-Key $Size;$property=$Part.quantities.PSObject.Properties|Where-Object{$_.Name-eq$key}|Select-Object -First 1;if($null-eq$property){return 0};return [long]$property.Value}

function Parse-GroupRange([string]$Key){
  $scoped=[regex]::Match($Key,'^S(?<sheet>[0-9]+)!G(?<start>[0-9]+)(?::G(?<end>[0-9]+))?$',[Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if($scoped.Success){$end=if($scoped.Groups['end'].Success){[int]$scoped.Groups['end'].Value}else{[int]$scoped.Groups['start'].Value};return [pscustomobject]@{sheetIndex=[int]$scoped.Groups['sheet'].Value;startRow=[int]$scoped.Groups['start'].Value;endRow=$end}}
  $legacy=[regex]::Match($Key,'^G(?<start>[0-9]+)(?::G(?<end>[0-9]+))?$',[Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if($legacy.Success){$end=if($legacy.Groups['end'].Success){[int]$legacy.Groups['end'].Value}else{[int]$legacy.Groups['start'].Value};return [pscustomobject]@{sheetIndex=1;startRow=[int]$legacy.Groups['start'].Value;endRow=$end}}
  return [pscustomobject]@{sheetIndex=0;startRow=0;endRow=0}
}
function Get-MaterialImages($Material,$Index){
  $ranges=@($Material.imageGroups|ForEach-Object{Parse-GroupRange ([string]$_)})
  foreach($image in @($Index.images)){foreach($range in $ranges){if([int]$image.sheetIndex-eq[int]$range.sheetIndex-and[int]$image.row-ge[int]$range.startRow-and[int]$image.row-le[int]$range.endRow){return @($image)}}}
  return @()
}

function Merge-MaterialGroupsByImage($Materials,$Index){
  $groups=[ordered]@{}
  foreach($material in @($Materials)){
    $images=@(Get-MaterialImages $material $Index)
    if(-not$images.Count){throw "IMAGE_NOT_FOUND: $([string]$material.imageGroupKey) / Không tìm thấy hình ảnh đại diện cho nhóm sản phẩm"}
    $image=$images[0];$key=(Normalize-Key ([string]$material.material))+'|'+([string]$image.hash)
    if(-not$groups.Contains($key)){$groups[$key]=[ordered]@{
      material=[string]$material.material;codes=[Collections.Generic.List[string]]::new();codeSeen=@{};sizes=[Collections.Generic.List[string]]::new();sizeSeen=@{};productMap=[ordered]@{};partMap=[ordered]@{};images=@($image)
    }}
    $target=$groups[$key]
    foreach($code in @($material.codes)){$codeKey=Normalize-Key ([string]$code);if(-not$target.codeSeen.ContainsKey($codeKey)){$target.codeSeen[$codeKey]=$true;$target.codes.Add([string]$code)}}
    foreach($size in @($material.sizes)){$sizeKey=Normalize-Key ([string]$size);if(-not$target.sizeSeen.ContainsKey($sizeKey)){$target.sizeSeen[$sizeKey]=$true;$target.sizes.Add([string]$size)}}
    foreach($product in @($material.products)){$productKey=(Normalize-Key ([string]$product.code))+'|'+(Normalize-Key ([string]$product.size));if(-not$target.productMap.Contains($productKey)){$target.productMap[$productKey]=[pscustomobject]@{code=[string]$product.code;size=[string]$product.size}}}
    foreach($part in @($material.parts)){
      $partKey=Normalize-Key ([string]$part.part)
      if(-not$target.partMap.Contains($partKey)){$target.partMap[$partKey]=[ordered]@{part=[string]$part.part;noteEntries=[Collections.Generic.List[object]]::new();noteSeen=@{};quantities=[ordered]@{}}}
      $partTarget=$target.partMap[$partKey]
      foreach($entry in @($part.noteEntries)){
        if([string]::IsNullOrWhiteSpace([string]$entry.note)){continue}
        $noteKey=(Normalize-Key ([string]$entry.code))+'|'+(Normalize-Key ([string]$entry.size))+'|'+(Normalize-Key ([string]$entry.note))
        if(-not$partTarget.noteSeen.ContainsKey($noteKey)){$partTarget.noteSeen[$noteKey]=$true;$partTarget.noteEntries.Add([pscustomobject]@{code=[string]$entry.code;size=[string]$entry.size;part=[string]$entry.part;note=[string]$entry.note})}
      }
      foreach($quantity in @($part.quantities.PSObject.Properties)){$sizeKey=Normalize-Key ([string]$quantity.Name);$partTarget.quantities[$sizeKey]=[long]($partTarget.quantities[$sizeKey])+[long]$quantity.Value}
    }
  }
  $result=@()
  foreach($target in @($groups.Values)){
    $parts=@();foreach($part in @($target.partMap.Values)){$parts+=[pscustomobject]@{part=$part.part;noteEntries=@($part.noteEntries);quantities=[pscustomobject]$part.quantities}}
    $products=if($target.productMap.Count){@($target.productMap.Values)}else{@($target.codes|ForEach-Object{[pscustomobject]@{code=$_;size=''}})}
    $result+=[pscustomobject]@{material=$target.material;codes=@($target.codes);sizes=@($target.sizes);products=$products;parts=$parts;images=@($target.images)}
  }
  return @($result)
}

function Draw-RepresentativeImage($Graphics,$Images,[float]$X,[float]$Y,[float]$Width,[float]$Height){
  $imageInfo=@($Images|Select-Object -First 1);if(-not$imageInfo.Count){return};$path=[string]$imageInfo[0].path;if(-not(Test-Path -LiteralPath $path)){return}
  $image=[Drawing.Image]::FromFile($path);try{$scale=[Math]::Min($Width/$image.Width,$Height/$image.Height);$w=[float]($image.Width*$scale);$h=[float]($image.Height*$scale);$left=$X+($Width-$w)/2;$top=$Y+($Height-$h)/2;$Graphics.DrawImage($image,$left,$top,$w,$h)}finally{$image.Dispose()}
}

function Get-NoteRows($Parts,$Sizes){
  $sizeSet=@{};foreach($size in @($Sizes)){$sizeSet[(Normalize-Key ([string]$size))]=$true};$groups=[ordered]@{}
  foreach($part in @($Parts)){foreach($entry in @($part.noteEntries)){
    $note=[string]$entry.note;if([string]::IsNullOrWhiteSpace($note)){continue};$sizeKey=Normalize-Key ([string]$entry.size);if(-not$sizeSet.ContainsKey($sizeKey)){continue}
    $key=$sizeKey+'|'+(Normalize-Key ([string]$entry.part))+'|'+(Normalize-Key $note)
    if(-not$groups.Contains($key)){$groups[$key]=[ordered]@{codes=[Collections.Generic.List[string]]::new();codeSeen=@{};size=[string]$entry.size;part=[string]$entry.part;note=$note}}
    $target=$groups[$key];$codeKey=Normalize-Key ([string]$entry.code);if(-not$target.codeSeen.ContainsKey($codeKey)){$target.codeSeen[$codeKey]=$true;$target.codes.Add([string]$entry.code)}
  }}
  return @($groups.Values|ForEach-Object{[pscustomobject]@{codes=@($_.codes);size=$_.size;part=$_.part;note=$_.note}})
}

function Get-NoteRowHeight($Graphics,$Row,[Drawing.Font]$Font){
  $heights=@(
    (Measure-WrappedHeight $Graphics ((@($Row.codes)-join', ')) $Font 174 42),
    (Measure-WrappedHeight $Graphics ([string]$Row.size) $Font 74 42),
    (Measure-WrappedHeight $Graphics ([string]$Row.part) $Font 264 42),
    (Measure-WrappedHeight $Graphics ([string]$Row.note) $Font 434 42)
  );return [float](($heights|Measure-Object -Maximum).Maximum)
}

function Split-NoteRowsByHeight($Graphics,$Rows,[Drawing.Font]$Font,[float]$MaximumHeight){
  $result=@();$current=[Collections.Generic.List[object]]::new();$height=0.0
  foreach($row in @($Rows)){$rowHeight=Get-NoteRowHeight $Graphics $row $Font;if($rowHeight-gt$MaximumHeight){throw "NOTE_TOO_LONG: $([string]$row.part) / Ghi chú quá dài để in trong một trang"}
    if($current.Count-and($height+$rowHeight)-gt$MaximumHeight){$result+=,@($current);$current=[Collections.Generic.List[object]]::new();$height=0.0}
    $row|Add-Member -NotePropertyName rowHeight -NotePropertyValue $rowHeight -Force;$current.Add($row);$height+=$rowHeight
  }
  if($current.Count){$result+=,@($current)};if(-not$result.Count){$result+=,@()};return @($result)
}

function Get-PageCodes($Material,$Sizes,$NoteRows){
  $sizeSet=@{};foreach($size in @($Sizes)){$sizeSet[(Normalize-Key ([string]$size))]=$true};$codes=[Collections.Generic.List[string]]::new();$seen=@{}
  foreach($product in @($Material.products)){if($sizeSet.ContainsKey((Normalize-Key ([string]$product.size)))){$key=Normalize-Key ([string]$product.code);if(-not$seen.ContainsKey($key)){$seen[$key]=$true;$codes.Add([string]$product.code)}}}
  foreach($row in @($NoteRows)){foreach($code in @($row.codes)){$key=Normalize-Key ([string]$code);if(-not$seen.ContainsKey($key)){$seen[$key]=$true;$codes.Add([string]$code)}}}
  if(-not$codes.Count){foreach($code in @($Material.codes)){$key=Normalize-Key ([string]$code);if(-not$seen.ContainsKey($key)){$seen[$key]=$true;$codes.Add([string]$code)}}};return @($codes)
}

function New-MaterialPages($Material,[string]$OrderLabel){
  $measureBitmap=[Drawing.Bitmap]::new(1,1);$graphics=[Drawing.Graphics]::FromImage($measureBitmap);$body=New-Font 22 Regular;$bodyBold=New-Font 22 Bold;$note=New-Font 21 Regular
  try{
    $pages=@();$sizes=@($Material.sizes);$parts=@($Material.parts);$sizeGroups=@(Split-Items $sizes 8);$mainHeightLimit=576.0;$noteHeightLimit=258.0
    foreach($sizeGroup in $sizeGroups){$partIndex=0
      while($partIndex-lt$parts.Count){$pageParts=[Collections.Generic.List[object]]::new();$mainHeight=0.0;$candidateNotes=@()
        while($partIndex-lt$parts.Count-and$pageParts.Count-lt 8){$source=$parts[$partIndex];$rowHeight=Measure-WrappedHeight $graphics ([string]$source.part) $body 454 68;$wrapped=[pscustomobject]@{part=[string]$source.part;quantities=$source.quantities;noteEntries=@($source.noteEntries);sequence=$partIndex+1;rowHeight=$rowHeight}
          $nextParts=@($pageParts)+@($wrapped);$nextMain=$mainHeight+$rowHeight;$materialNeeded=Measure-WrappedHeight $graphics ([string]$Material.material) $bodyBold 314 68;$notes=Get-NoteRows $nextParts $sizeGroup;$noteHeight=0.0;foreach($noteRow in $notes){$noteHeight+=Get-NoteRowHeight $graphics $noteRow $note}
          if($pageParts.Count-and(($nextMain-gt$mainHeightLimit)-or([Math]::Max($nextMain,$materialNeeded)-gt$mainHeightLimit)-or($noteHeight-gt$noteHeightLimit))){break}
          if((-not$pageParts.Count)-and([Math]::Max($nextMain,$materialNeeded)-gt$mainHeightLimit)){throw "TEXT_TOO_LONG: $([string]$source.part) / Nội dung bộ phận cắt quá dài để in"}
          $pageParts.Add($wrapped);$mainHeight=$nextMain;$candidateNotes=$notes;$partIndex++
        }
        if(-not$candidateNotes.Count){$pages+=[pscustomobject]@{material=$Material;sizes=@($sizeGroup);parts=@($pageParts);noteRows=@();codes=@(Get-PageCodes $Material $sizeGroup @());images=@($Material.images);orderLabel=$OrderLabel}}
        else{$noteGroups=@(Split-NoteRowsByHeight $graphics $candidateNotes $note $noteHeightLimit);for($noteIndex=0;$noteIndex-lt$noteGroups.Count;$noteIndex++){$shownParts=if($noteIndex-eq 0){@($pageParts)}else{@()};$noteRows=@($noteGroups[$noteIndex]);$pages+=[pscustomobject]@{material=$Material;sizes=@($sizeGroup);parts=$shownParts;noteRows=$noteRows;codes=@(Get-PageCodes $Material $sizeGroup $noteRows);images=@($Material.images);orderLabel=$OrderLabel}}}
      }
    }
    return @($pages)
  }finally{$graphics.Dispose();$measureBitmap.Dispose();$body.Dispose();$bodyBold.Dispose();$note.Dispose()}
}

function Save-Page($Page,[string]$Path){
  $bitmap=[Drawing.Bitmap]::new(1754,1240);$graphics=[Drawing.Graphics]::FromImage($bitmap);$graphics.SmoothingMode='HighQuality';$graphics.InterpolationMode='HighQualityBicubic';$graphics.TextRenderingHint='AntiAliasGridFit'
  $white=New-Brush '#ffffff';$navy=New-Brush '#162e5e';$soft=New-Brush '#eef4fb';$text=New-Brush '#111827';$muted=New-Brush '#516175';$pen=[Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#27364d'),2)
  $title=New-Font 46 Bold;$label=New-Font 19 Bold;$value=New-Font 27 Bold;$value12=New-Font 25 Bold;$value11=New-Font 23 Bold;$value10=New-Font 21 Bold;$value9=New-Font 19 Bold;$head=New-Font 22 Bold;$body=New-Font 22 Regular;$bodyBold=New-Font 22 Bold;$sizeFont=New-Font 29 Bold;$quantity14=New-Font 29 Bold;$quantity13=New-Font 27 Bold;$quantity12=New-Font 25 Bold;$noteFont=New-Font 21 Regular;$small=New-Font 19 Regular
  try{
    $graphics.FillRectangle($white,0,0,1754,1240);$margin=36.0;$contentWidth=1682.0
    $leftHeader=[Drawing.RectangleF]::new($margin,24,430,132);$rightHeader=[Drawing.RectangleF]::new(466,24,1252,132);$graphics.DrawRectangle($pen,$leftHeader.X,$leftHeader.Y,$leftHeader.Width,$leftHeader.Height);$graphics.DrawRectangle($pen,$rightHeader.X,$rightHeader.Y,$rightHeader.Width,$rightHeader.Height)
    Draw-BoxText $graphics 'MÃ HÀNG' $label $muted ([Drawing.RectangleF]::new(52,34,398,25)) 'Near' 'Center';Draw-ItemListFitted $graphics @($Page.codes) @($value,$value12,$value11,$value10,$value9) $navy ([Drawing.RectangleF]::new(52,61,398,84))
    Draw-BoxText $graphics 'ĐƠN CẮT LIỆU' $title $navy ([Drawing.RectangleF]::new(488,30,1208,58)) 'Center' 'Center';Draw-BoxText $graphics 'ĐƠN HÀNG' $label $muted ([Drawing.RectangleF]::new(500,99,124,34)) 'Near' 'Center';Draw-WrappedTextFitted $graphics ([string]$Page.orderLabel) @($value,$value12,$value11,$value10,$value9) $text ([Drawing.RectangleF]::new(624,91,892,52)) 'Near'
    if([int]$Page.groupPageCount-gt 1){Draw-BoxText $graphics ("Trang {0}/{1}"-f$Page.groupPageNumber,$Page.groupPageCount) $small $muted ([Drawing.RectangleF]::new(1518,100,178,34)) 'Far' 'Center'}
    $y=174.0;$headerHeight=72.0;$seqWidth=60.0;$materialWidth=330.0;$partWidth=470.0;$sizeWidth=($contentWidth-$seqWidth-$materialWidth-$partWidth)/[Math]::Max(1,@($Page.sizes).Count)
    $headers=@(@{text='STT';width=$seqWidth},@{text='TÊN VẬT LIỆU';width=$materialWidth},@{text='BỘ PHẬN CẮT';width=$partWidth});$x=$margin
    foreach($header in $headers){Draw-Cell $graphics $pen $soft ([Drawing.RectangleF]::new($x,$y,$header.width,$headerHeight)) $header.text $head $text;$x+=$header.width}
    foreach($size in @($Page.sizes)){Draw-Cell $graphics $pen $soft ([Drawing.RectangleF]::new($x,$y,$sizeWidth,$headerHeight)) ([string]$size) $sizeFont $text;$x+=$sizeWidth}
    $dataY=$y+$headerHeight;$parts=@($Page.parts);$materialHeight=if($parts.Count){[float](($parts|ForEach-Object{[float]$_.rowHeight}|Measure-Object -Sum).Sum)}else{68.0}
    Draw-Cell $graphics $pen $white ([Drawing.RectangleF]::new($margin+$seqWidth,$dataY,$materialWidth,$materialHeight)) ([string]$Page.material.material) $bodyBold $text 'Center'
    if(-not$parts.Count){Draw-Cell $graphics $pen $white ([Drawing.RectangleF]::new($margin,$dataY,$seqWidth,68)) '' $body $text;Draw-Cell $graphics $pen $white ([Drawing.RectangleF]::new($margin+$seqWidth+$materialWidth,$dataY,$partWidth,68)) 'GHI CHÚ TIẾP THEO' $body $muted 'Center';$sx=$margin+$seqWidth+$materialWidth+$partWidth;foreach($size in @($Page.sizes)){Draw-Cell $graphics $pen $white ([Drawing.RectangleF]::new($sx,$dataY,$sizeWidth,68)) '' $body $text;$sx+=$sizeWidth}}
    $top=$dataY;foreach($part in $parts){$rowHeight=[float]$part.rowHeight
      Draw-Cell $graphics $pen $white ([Drawing.RectangleF]::new($margin,$top,$seqWidth,$rowHeight)) ([string]$part.sequence) $body $text
      Draw-Cell $graphics $pen $white ([Drawing.RectangleF]::new($margin+$seqWidth+$materialWidth,$top,$partWidth,$rowHeight)) ([string]$part.part) $body $text 'Near'
      $sx=$margin+$seqWidth+$materialWidth+$partWidth;foreach($size in @($Page.sizes)){$quantity=Get-Quantity $part ([string]$size);$display=if($quantity-gt 0){$quantity.ToString('N0',[Globalization.CultureInfo]::InvariantCulture)}else{''};$rect=[Drawing.RectangleF]::new($sx,$top,$sizeWidth,$rowHeight);$graphics.FillRectangle($white,$rect);$graphics.DrawRectangle($pen,$rect.X,$rect.Y,$rect.Width,$rect.Height);Draw-SingleLineFitted $graphics $display @($quantity14,$quantity13,$quantity12) $text $rect;$sx+=$sizeWidth};$top+=$rowHeight
    }
    $notesX=$margin;$bottomY=850.0;$notesWidth=1010.0;$bottomHeight=346.0;$photoX=1068.0;$photoWidth=650.0;$sectionHeader=40.0;$noteHeader=48.0
    $graphics.DrawRectangle($pen,$notesX,$bottomY,$notesWidth,$bottomHeight);$graphics.FillRectangle($soft,$notesX,$bottomY,$notesWidth,$sectionHeader);Draw-BoxText $graphics 'GHI CHÚ' $head $text ([Drawing.RectangleF]::new($notesX+10,$bottomY,$notesWidth-20,$sectionHeader)) 'Near' 'Center'
    $noteY=$bottomY+$sectionHeader;$noteWidths=@(190.0,90.0,280.0,450.0);$noteHeaders=@('MÃ HÀNG','SIZE','BỘ PHẬN CẮT','GHI CHÚ');$nx=$notesX
    for($n=0;$n-lt$noteHeaders.Count;$n++){Draw-Cell $graphics $pen $soft ([Drawing.RectangleF]::new($nx,$noteY,$noteWidths[$n],$noteHeader)) $noteHeaders[$n] $label $text;$nx+=$noteWidths[$n]}
    $noteTop=$noteY+$noteHeader;foreach($noteRow in @($Page.noteRows)){$height=[float]$noteRow.rowHeight;$values=@((@($noteRow.codes)-join', '),[string]$noteRow.size,[string]$noteRow.part,[string]$noteRow.note);$nx=$notesX;for($n=0;$n-lt$values.Count;$n++){Draw-Cell $graphics $pen $white ([Drawing.RectangleF]::new($nx,$noteTop,$noteWidths[$n],$height)) $values[$n] $noteFont $text 'Near';$nx+=$noteWidths[$n]};$noteTop+=$height}
    if($noteTop-lt$bottomY+$bottomHeight){$remaining=($bottomY+$bottomHeight)-$noteTop;$graphics.DrawRectangle($pen,$notesX,$noteTop,$notesWidth,$remaining);$lineX=$notesX;for($n=0;$n-lt$noteWidths.Count-1;$n++){$lineX+=$noteWidths[$n];$graphics.DrawLine($pen,$lineX,$noteTop,$lineX,$bottomY+$bottomHeight)}}
    $graphics.DrawRectangle($pen,$photoX,$bottomY,$photoWidth,$bottomHeight);$graphics.FillRectangle($soft,$photoX,$bottomY,$photoWidth,$sectionHeader);Draw-BoxText $graphics 'HÌNH ẢNH' $head $text ([Drawing.RectangleF]::new($photoX+10,$bottomY,$photoWidth-20,$sectionHeader)) 'Near' 'Center';Draw-RepresentativeImage $graphics $Page.images ($photoX+10) ($bottomY+$sectionHeader+8) ($photoWidth-20) ($bottomHeight-$sectionHeader-18)
    $codec=[Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()|Where-Object{$_.MimeType-eq'image/jpeg'}|Select-Object -First 1;$parameters=[Drawing.Imaging.EncoderParameters]::new(1);$parameters.Param[0]=[Drawing.Imaging.EncoderParameter]::new([Drawing.Imaging.Encoder]::Quality,[long]92);try{$bitmap.Save($Path,$codec,$parameters)}finally{$parameters.Dispose()}
  }finally{$graphics.Dispose();$bitmap.Dispose();$white.Dispose();$navy.Dispose();$soft.Dispose();$text.Dispose();$muted.Dispose();$pen.Dispose();$title.Dispose();$label.Dispose();$value.Dispose();$value12.Dispose();$value11.Dispose();$value10.Dispose();$value9.Dispose();$head.Dispose();$body.Dispose();$bodyBold.Dispose();$sizeFont.Dispose();$quantity14.Dispose();$quantity13.Dispose();$quantity12.Dispose();$noteFont.Dispose();$small.Dispose()}
}

function Write-Ascii($Stream,[string]$Text){$bytes=[Text.Encoding]::ASCII.GetBytes($Text);$Stream.Write($bytes,0,$bytes.Length)}
function New-PdfFromJpegs($Jpegs,[string]$Path){
  $stream=[IO.File]::Create($Path);$offsets=@{};try{Write-Ascii $stream "%PDF-1.4`n%`xE2`xE3`xCF`xD3`n";$catalog=1;$pages=2;$next=3;$pageIds=@();$imageIds=@();$contentIds=@();foreach($jpg in $Jpegs){$pageIds+=$next;$next++;$imageIds+=$next;$next++;$contentIds+=$next;$next++}
    function Write-Obj($S,$O,[int]$Id,[string]$Body){$O[$Id]=[int64]$S.Position;Write-Ascii $S "$Id 0 obj`n$Body`nendobj`n"}
    Write-Obj $stream $offsets $catalog "<< /Type /Catalog /Pages $pages 0 R >>";$kids=($pageIds|ForEach-Object{"$_ 0 R"})-join' ';Write-Obj $stream $offsets $pages "<< /Type /Pages /Kids [ $kids ] /Count $($pageIds.Count) >>"
    for($i=0;$i-lt$Jpegs.Count;$i++){$bytes=[IO.File]::ReadAllBytes($Jpegs[$i]);$image=[Drawing.Image]::FromFile($Jpegs[$i]);try{$id=$imageIds[$i];$offsets[$id]=[int64]$stream.Position;Write-Ascii $stream "$id 0 obj`n<< /Type /XObject /Subtype /Image /Width $($image.Width) /Height $($image.Height) /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length $($bytes.Length) >>`nstream`n";$stream.Write($bytes,0,$bytes.Length);Write-Ascii $stream "`nendstream`nendobj`n"}finally{$image.Dispose()}
      $content="q`n842 0 0 595 0 0 cm`n/Im$i Do`nQ`n";$contentBytes=[Text.Encoding]::ASCII.GetBytes($content);$cid=$contentIds[$i];$offsets[$cid]=[int64]$stream.Position;Write-Ascii $stream "$cid 0 obj`n<< /Length $($contentBytes.Length) >>`nstream`n";$stream.Write($contentBytes,0,$contentBytes.Length);Write-Ascii $stream "endstream`nendobj`n";Write-Obj $stream $offsets $pageIds[$i] "<< /Type /Page /Parent $pages 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Im$i $($imageIds[$i]) 0 R >> >> /Contents $cid 0 R >>"}
    $xref=$stream.Position;Write-Ascii $stream "xref`n0 $next`n0000000000 65535 f `n";for($id=1;$id-lt$next;$id++){$offset=if($offsets.ContainsKey($id)){[int64]$offsets[$id]}else{0};Write-Ascii $stream ("{0:0000000000} 00000 n `n"-f$offset)};Write-Ascii $stream "trailer`n<< /Size $next /Root $catalog 0 R >>`nstartxref`n$xref`n%%EOF"
  }finally{$stream.Dispose()}
}

function New-PiecePdf($Payload){
  $index=Build-TemplateCache $Payload.template;$materials=@(Merge-MaterialGroupsByImage $Payload.report.materials $index);if(-not$materials.Count){throw 'NO_PRINT_DATA / 沒有可列印的裁片資料'}
  $temp=Join-Path ([IO.Path]::GetTempPath()) ($script:TempPrefix+[Guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($temp)|Out-Null;$pages=@()
  foreach($material in $materials){$materialPages=@(New-MaterialPages $material ([string]$Payload.report.orderLabel));for($pageIndex=0;$pageIndex-lt$materialPages.Count;$pageIndex++){$materialPages[$pageIndex]|Add-Member -NotePropertyName groupPageNumber -NotePropertyValue ($pageIndex+1) -Force;$materialPages[$pageIndex]|Add-Member -NotePropertyName groupPageCount -NotePropertyValue $materialPages.Count -Force;$pages+=$materialPages[$pageIndex]}}
  if(-not$pages.Count){throw 'NO_PRINT_PAGES / 沒有可列印頁面'};$jpegs=@();for($i=0;$i-lt$pages.Count;$i++){$jpg=Join-Path $temp ("page_{0:000}.jpg"-f($i+1));Save-Page $pages[$i] $jpg;$jpegs+=$jpg}
  $pdf=Join-Path $temp 'piece-cutting.pdf';New-PdfFromJpegs $jpegs $pdf;return @{pdf=$pdf;temp=$temp}
}

function Send-Pdf($Response,[string]$Path,[string]$Name){
  $bytes=[IO.File]::ReadAllBytes($Path);Set-ResponseHeaders $Response;$Response.StatusCode=200;$Response.ContentType='application/pdf';$Response.Headers['Content-Disposition']='attachment; filename="piece-cutting.pdf"';$Response.ContentLength64=$bytes.Length;$Response.OutputStream.Write($bytes,0,$bytes.Length);$Response.Close()
}

Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter "$($script:TempPrefix)*" -ErrorAction SilentlyContinue|Where-Object{$_.LastWriteTime-lt(Get-Date).AddHours(-24)}|Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
$listener=[Net.HttpListener]::new();$listener.Prefixes.Add($script:Prefix);$listener.Start();Write-Host "Cong cu PDF cat chi tiet da mo / 裁片 PDF 工具已啟動: $($script:Prefix)";Write-Host 'Nhan Ctrl+C de dung / 按 Ctrl+C 停止'
while($listener.IsListening){$context=$listener.GetContext();$request=$context.Request;$response=$context.Response;$job=$null
  try{$script:CorsOrigin='';$origin=[string]$request.Headers['Origin'];if(-not(Test-AllowedOrigin $origin)){Send-Text $response 403 '{"ok":false,"error":"ORIGIN_NOT_ALLOWED / 不允許的網站來源"}';continue};if($origin){$script:CorsOrigin=$origin}
    if($request.HttpMethod-eq'OPTIONS'){Send-Text $response 204 '';continue};$path=$request.Url.AbsolutePath
    if($path-eq'/health'-and$request.HttpMethod-eq'GET'){Send-Json $response 200 @{ok=$true;service='piece-cutting-pdf-local';port=$Port};continue}
    if($path-eq'/piece-cutting/cache/status'-and$request.HttpMethod-eq'POST'){$payload=Read-Json $request;Send-Json $response 200 (Get-CacheStatus $payload);continue}
    if($path-eq'/piece-cutting/cache'-and$request.HttpMethod-eq'DELETE'){Send-Json $response 200 (Clear-Cache);continue}
    if($path-eq'/piece-cutting/pdf'-and$request.HttpMethod-eq'POST'){$payload=Read-Json $request;$job=New-PiecePdf $payload;Send-Pdf $response $job.pdf ([string]$payload.outputName);continue}
    Send-Text $response 404 '{"ok":false,"error":"NOT_FOUND"}'
  }catch{$detail=($_.Exception.Message-replace'[\r\n"]',' ');try{Send-Json $response 500 @{ok=$false;error=$detail}}catch{try{$response.Close()}catch{}}}finally{if($null-ne$job-and$job.temp-and(Test-Path -LiteralPath $job.temp)){Remove-Item -LiteralPath $job.temp -Recurse -Force -ErrorAction SilentlyContinue}}
}
