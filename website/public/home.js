const menuButton=document.querySelector('.menu-toggle');
const mobileMenu=document.querySelector('.mobile-nav');
function closeMenu(){menuButton.setAttribute('aria-expanded','false');menuButton.setAttribute('aria-label','메뉴 열기');mobileMenu.hidden=true;}
menuButton.addEventListener('click',()=>{const open=menuButton.getAttribute('aria-expanded')!=='true';menuButton.setAttribute('aria-expanded',String(open));menuButton.setAttribute('aria-label',open?'메뉴 닫기':'메뉴 열기');mobileMenu.hidden=!open;});
mobileMenu.addEventListener('click',event=>{if(event.target.closest('a'))closeMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!mobileMenu.hidden){closeMenu();menuButton.focus();}});
const tools=[...document.querySelectorAll('.tool-card')];
tools.forEach(detail=>detail.addEventListener('toggle',()=>{if(detail.open)tools.forEach(other=>{if(other!==detail)other.open=false;});}));
if('IntersectionObserver' in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches){document.body.classList.add('has-motion');const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('in');observer.unobserve(entry.target);}});},{threshold:.07});document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));}
const progress=document.querySelector('.reading-progress');let scheduled=false;function updateProgress(){const total=document.documentElement.scrollHeight-innerHeight;progress.style.transform='scaleX('+(total>0?Math.min(1,scrollY/total):0)+')';scheduled=false;}
addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(updateProgress);}},{passive:true});addEventListener('resize',updateProgress);updateProgress();

